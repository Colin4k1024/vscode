#!/usr/bin/env bash
# D08 / Issue #10, route decision 1 hook for D09 — Copilot artifact hard gate.
#
# D08 keeps extensions/copilot in the repo but disabled by default (route decision (a)).
# D10 section 5 makes @vscode/copilot-api / @github/copilot a redistribution HARD
# BLOCKER: any externally distributed build must not contain them. D09's
# verify-beta-gates must call this script against every packaged artifact
# directory (the extracted app contents) before publishing.
#
# The block list is DATA, not code (D66 / issue #66 M8): it is read from the
# mixin's product/product.json `copilotPackagingBlocklist` — the same list the
# desktop packageTask excludes by — so packaging and this gate can never
# disagree. The script fails closed when the mixin is missing the list.
#
# Usage: bash scripts/check-no-copilot-artifacts.sh <artifact-dir> [<dir>...]
# Exit 0 when clean; exit 1 otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
	echo "usage: $0 <artifact-dir> [<dir>...]" >&2
	exit 2
fi

command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH" >&2; exit 1; }

# The block list, one package per line, from the mixin (single source of
# truth). Fail closed when absent/empty: a gate with no list is no gate.
# BLOCKLIST_JSON is the same list as a JSON array (consumed by the asar
# member scanner).
BLOCKLIST_JSON=""
BLOCKLIST_NDJSON=""
read_blocklists() {
	local out
	out="$(node -e "
const overlay = JSON.parse(require('fs').readFileSync('$REPO_ROOT/product/product.json', 'utf8'));
const list = overlay.copilotPackagingBlocklist;
if (!Array.isArray(list) || list.length === 0) {
	console.error('ERROR: product/product.json has no copilotPackagingBlocklist — the mixin must name the D10 section 5 block-listed packages.');
	process.exit(1);
}
for (const e of list) {
	if (typeof e !== 'string' || !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(e)) {
		console.error('ERROR: malformed copilotPackagingBlocklist entry: ' + JSON.stringify(e));
		process.exit(1);
	}
}
console.log(JSON.stringify(list));
console.log(list.join('\n'));
")" || exit 1
	BLOCKLIST_JSON="$(printf '%s\n' "$out" | head -1)"
	BLOCKLIST_NDJSON="$(printf '%s\n' "$out" | tail -n +2)"
}
read_blocklists

# Build the find(1) -path pattern group for the block list: each package is
# matched as an exact directory (and everything under it) in ANY node_modules
# tree AND in a node_modules.asar.unpacked tree (createAsar writes unpacked
# members to <dest>.asar.unpacked/<relative> — a real directory the -type d
# scan must cover; issue #66 review finding 2).
FIND_ARGS=()
while IFS= read -r pkg; do
	FIND_ARGS+=(-o -path "*node_modules/${pkg}" -o -path "*node_modules/${pkg}/*" -o -path "*node_modules.asar.unpacked/${pkg}" -o -path "*node_modules.asar.unpacked/${pkg}/*")
done <<< "$BLOCKLIST_NDJSON"
FIND_ARGS=("${FIND_ARGS[@]:1}") # drop the leading -o

status=0
for dir in "$@"; do
	if [ ! -d "$dir" ]; then
		echo "ERROR: not a directory: $dir" >&2
		status=1
		continue
	fi

	# 1. The in-repo Copilot Chat extension must not be bundled.
	while IFS= read -r hit; do
		echo "BLOCKED: copilot extension bundled: $hit" >&2
		status=1
	done < <(find "$dir" -type d \( -name 'copilot' -o -name 'copilot-chat' \) -path '*extensions*' 2>/dev/null || true)

	# 2. Restricted packages (D10 section 5 block list, from the mixin) must
	#    not appear in any node_modules or node_modules.asar.unpacked tree.
	#
	#    FAIL-CLOSED second layer (review round-1, MEDIUM-2): in ADDITION to
	#    the exact block-list matches, sweep for the whole @github/copilot*
	#    prefix so a future @github/copilot-* package that nobody adjudicated
	#    is still caught. The allowlist is evaluated against the path segment
	#    AFTER THE LAST node_modules(/(.asar.unpacked))?/ — so a
	#    @github/copilot nested inside an allowlisted package's own
	#    node_modules is still blocked (a grep -v over the full path would
	#    have let it through).
	#
	#    Allowlisted: @github/copilot-sdk and @github/copilot-sdk-* — MIT-
	#    licensed and load-bearing (agentHostMain imports it statically;
	#    D09 verified empirically: removing it crashes the agent host at
	#    startup). Note the separator requirement: a hypothetical
	#    "@github/copilot-sdkfoo" does NOT match and stays blocked.
	while IFS= read -r hit; do
		rest="${hit##*/node_modules/}"
		rest="${rest##*/node_modules.asar.unpacked/}"
		case "$rest" in
			@github/copilot-sdk|@github/copilot-sdk/*|@github/copilot-sdk-*)
				;; # allowlisted (MIT, load-bearing)
			*)
				echo "BLOCKED: restricted redistributable package present: $hit" >&2
				status=1
				;;
		esac
	done < <( { find "$dir" -type d \( "${FIND_ARGS[@]}" \) 2>/dev/null; find "$dir" -type d \( -path '*node_modules/@github/copilot*' -o -path '*node_modules.asar.unpacked/@github/copilot*' \) 2>/dev/null; } | sort -u | head -50 || true)

	# 3. The same block list applies INSIDE the packaged node_modules.asar.
	#    The asar is a FILE, so the directory scans above are blind to it (M1).
	#    Member paths are relative to the asar root with NO node_modules/
	#    prefix — createAsar roots the archive at the node_modules directory
	#    and Filesystem relativizes member paths against it, so members look
	#    like /@scope/pkg/... (verified against a real packaged app; issue
	#    #66 review finding 1). The node_modules/ segment is therefore
	#    OPTIONAL in the pattern; a nested copy inside another package's
	#    node_modules is still caught by the non-anchored alternation.
	ASAR_BIN="$REPO_ROOT/node_modules/.bin/asar"
	while IFS= read -r asar_file; do
		if [ ! -x "$ASAR_BIN" ]; then
			echo "ERROR: cannot verify $asar_file — asar CLI missing at $ASAR_BIN (run npm ci). A gate that cannot inspect the asar must not silently pass." >&2
			status=1
			continue
		fi
		if ! asar_listing="$("$ASAR_BIN" list "$asar_file" 2>/dev/null)"; then
			echo "ERROR: cannot list $asar_file — refusing to pass a gate that could not run" >&2
			status=1
			continue
		fi
		# Member filtering in node (the gate already requires it): match
		# blocked package paths, collapse to unique package names, apply the
		# @github/copilot-sdk* allowlist, print what is blocked. Fail-closed:
		# a filter crash fails the gate instead of passing an unexamined asar.
		if ! asar_blocked="$(printf '%s\n' "$asar_listing" | BLOCKLIST="$BLOCKLIST_JSON" node -e "
const readline = require('readline');
const blocklist = JSON.parse(process.env.BLOCKLIST);
const blocked = new Set();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
	for (const pkg of blocklist) {
		// Members are /<pkg>/... (asar rooted at node_modules); tolerate a
		// node_modules/ segment for archives rooted one level higher.
		const atRoot = line === '/' + pkg || line.startsWith('/' + pkg + '/');
		const i = line.indexOf('/' + pkg + '/');
		const nested = i !== -1 && line.slice(0, i).endsWith('node_modules');
		if (atRoot || nested) {
			blocked.add(pkg);
			return;
		}
	}
});
rl.on('close', () => { for (const b of [...blocked].sort()) { console.log(b); } });
")"; then
			echo "ERROR: asar member scan crashed for $asar_file — refusing to pass a gate that could not run" >&2
			status=1
			continue
		fi
		while IFS= read -r pkg_name; do
			[ -n "$pkg_name" ] || continue
			echo "BLOCKED: restricted redistributable package inside asar: $asar_file — $pkg_name" >&2
			status=1
		done <<< "$asar_blocked"
	done < <(find "$dir" -type f -name 'node_modules.asar' 2>/dev/null || true)

	# 4. The shipped product configuration must not reference the Copilot
	#    default chat agent or vscode-cdn.net.
	while IFS= read -r pj; do
		if grep -q 'defaultChatAgent\|vscode-cdn\.net' "$pj"; then
			echo "BLOCKED: $pj still references defaultChatAgent / vscode-cdn.net" >&2
			status=1
		fi
	done < <(find "$dir" -maxdepth 4 -name 'product.json' 2>/dev/null || true)
done

if [ "$status" -eq 0 ]; then
	echo "copilot artifact gate: clean ($*)"
fi
exit "$status"
