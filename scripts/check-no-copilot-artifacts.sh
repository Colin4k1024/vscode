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

	# 2b. Review #66 (M1): the packaged dependency tree ships as
	#     node_modules.asar — a FILE — so the `find -type d` pass above is
	#     blind to the asar half of the D10 block list. List every asar
	#     archive's entries and apply the same block rules. Fail-closed when
	#     the repo's asar module is unavailable: a gate that cannot see must
	#     not pass.
	while IFS= read -r asar_file; do
		if ! asar_listing="$(cd "$REPO_ROOT" && node -e '
			try {
				const asar = require("asar");
				process.stdout.write(asar.listPackage(process.argv[1]).join("\n"));
			} catch (err) {
				console.error("ASAR_LIST_ERROR: " + (err instanceof Error ? err.message : String(err)));
				process.exit(3);
			}
		' "$asar_file" 2>&1)"; then
			echo "BLOCKED: cannot list asar archive $asar_file (is the repo\'s asar devDependency installed? run npm ci): $asar_listing" >&2
			status=1
			continue
		fi
		while IFS= read -r entry; do
			case "$entry" in
				*node_modules/@vscode/copilot-api|*node_modules/@vscode/copilot-api/*|*node_modules/@github/blackbird-external-ingest-utils|*node_modules/@github/blackbird-external-ingest-utils/*)
					echo "BLOCKED: restricted redistributable package inside asar: $asar_file!$entry" >&2
					status=1
					;;
				*node_modules/@github/copilot*)
					case "$entry" in
						*node_modules/@github/copilot-sdk|*node_modules/@github/copilot-sdk/*|*node_modules/@github/copilot-sdk-*)
							;; # allowlisted (MIT, load-bearing)
						*)
							echo "BLOCKED: restricted redistributable package inside asar: $asar_file!$entry" >&2
							status=1
							;;
					esac
					;;
			esac
		done <<< "$asar_listing"
	done < <(find "$dir" -name '*.asar' -type f 2>/dev/null || true)

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
