#!/usr/bin/env bash
# D08 / Issue #10, route decision 1 hook for D09 — Copilot artifact hard gate.
#
# D08 keeps extensions/copilot in the repo but disabled by default (route decision (a)).
# D10 section 5 makes @vscode/copilot-api / @github/copilot a redistribution HARD
# BLOCKER: any externally distributed build must not contain them. D09's
# verify-beta-gates must call this script against every packaged artifact
# directory (the extracted app contents) before publishing.
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

	# 2. Restricted packages (D10 section 5 block list) must not appear in any
	#    node_modules: @vscode/copilot-api (GitHub npm Module Terms: Code-OSS
	#    dev-only, no redistribution), @github/copilot (unmodified-only),
	#    @github/blackbird-external-ingest-utils (same closure).
	#
	#    FAIL-CLOSED shape (review round-1, MEDIUM-2): match the whole
	#    @github/copilot* prefix first, then pass an exact allowlist. The
	#    allowlist is evaluated against the path segment AFTER THE LAST
	#    node_modules/ — so a @github/copilot nested inside an allowlisted
	#    package's own node_modules is still blocked (a grep -v over the
	#    full path would have let it through).
	#
	#    Allowlisted: @github/copilot-sdk and @github/copilot-sdk-* — MIT-
	#    licensed and load-bearing (agentHostMain imports it statically;
	#    D09 verified empirically: removing it crashes the agent host at
	#    startup). Note the separator requirement: a hypothetical
	#    "@github/copilot-sdkfoo" does NOT match and stays blocked.
	while IFS= read -r hit; do
		rest="${hit##*/node_modules/}"
		case "$rest" in
			@github/copilot-sdk|@github/copilot-sdk/*|@github/copilot-sdk-*|@github/copilot-sdk-*/*)
				;; # allowlisted (MIT, load-bearing)
			*)
				echo "BLOCKED: restricted redistributable package present: $hit" >&2
				status=1
				;;
		esac
	done < <(find "$dir" -type d \( -path '*node_modules/@vscode/copilot-api' -o -path '*node_modules/@vscode/copilot-api/*' -o -path '*node_modules/@github/copilot*' -o -path '*node_modules/@github/blackbird-external-ingest-utils' \) 2>/dev/null | head -50 || true)

	# 2b. The same block list applies INSIDE the packaged node_modules.asar.
	#     The asar is a FILE, so the `find -type d` above is blind to it (M1):
	#     a block-listed package present only inside the asar would slip
	#     through. List each asar's members and apply the same
	#     patterns/allowlist. Member paths are asar-root-relative, so
	#     `node_modules/<pkg>` in the listing corresponds to the shipped
	#     `app/node_modules.asar/<pkg>` content.
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
		# blocked package paths, collapse to unique package roots
		# (node_modules/@scope/name), apply the @github/copilot-sdk*
		# allowlist, print what is blocked. Fail-closed: a filter crash
		# fails the gate instead of passing an unexamined asar.
		if ! asar_blocked="$(printf '%s\n' "$asar_listing" | node -e "
const readline = require('readline');
const blocked = new Set();
const pattern = /(?:^|\/)node_modules\/(@vscode\/copilot-api|@github\/copilot[^\/]*|@github\/blackbird-external-ingest-utils)(\/|$)/;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
	const m = pattern.exec(line);
	if (!m) { return; }
	const root = m[1];
	if (root === '@github/copilot-sdk' || root.startsWith('@github/copilot-sdk-')) { return; } // allowlisted (MIT, load-bearing)
	blocked.add(root);
});
rl.on('close', () => { for (const b of [...blocked].sort()) { console.log(b); } });
")"; then
			echo "ERROR: asar member scan crashed for $asar_file — refusing to pass a gate that could not run" >&2
			status=1
			continue
		fi
		while IFS= read -r pkg_root; do
			[ -n "$pkg_root" ] || continue
			echo "BLOCKED: restricted redistributable package inside asar: $asar_file — $pkg_root" >&2
			status=1
		done <<< "$asar_blocked"
	done < <(find "$dir" -type f -name 'node_modules.asar' 2>/dev/null || true)

	# 3. The shipped product configuration must not reference the Copilot
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
