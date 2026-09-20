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

	# 2. Restricted SDK packages (D10 section 5) must not appear in any node_modules.
	while IFS= read -r hit; do
		echo "BLOCKED: restricted redistributable package present: $hit" >&2
		status=1
	done < <(find "$dir" -type d \( -path '*node_modules/@vscode/copilot-api' -o -path '*node_modules/@github/copilot' -o -path '*node_modules/@github/copilot-*' \) 2>/dev/null | head -50 || true)

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
