#!/usr/bin/env bash
# D08 / Issue #10 AC4 — credential residue scan.
#
# Scans a user-data directory (or any directory) for plaintext credential
# patterns in the telemetry/config persistence plane: logs, agent-host.db,
# CachedData, state.vscdb, argv.json, settings.json. Complements D03's AC9
# (auth flow must not persist tokens): this gate focuses on where telemetry
# and configuration land on disk.
#
# Usage: bash scripts/scan-credential-residue.sh <userDataDir> [<more dirs>...]
# Exit 0 when clean; exit 1 and print file:line matches otherwise.
set -euo pipefail

if [ $# -lt 1 ]; then
	echo "usage: $0 <userDataDir> [<more dirs>...]" >&2
	exit 2
fi

# Well-known plaintext token shapes (GitHub, OpenAI, generic Bearer blobs).
PATTERNS=(
	'ghp_[A-Za-z0-9]{20,}'
	'gho_[A-Za-z0-9]{20,}'
	'ghu_[A-Za-z0-9]{20,}'
	'ghs_[A-Za-z0-9]{20,}'
	'ghr_[A-Za-z0-9]{20,}'
	'github_pat_[A-Za-z0-9_]{20,}'
	'sk-[A-Za-z0-9_-]{20,}'
	'sk-proj-[A-Za-z0-9_-]{20,}'
	'Bearer [A-Za-z0-9._-]{20,}'
	'Authorization": *"[^"]{20,}'
)

status=0
for dir in "$@"; do
	if [ ! -d "$dir" ]; then
		echo "ERROR: not a directory: $dir" >&2
		status=1
		continue
	fi
	for pattern in "${PATTERNS[@]}"; do
		# Text-ish persistence files only; sqlite DBs are scanned via strings(1)
		# because grep on binary sqlite pages misses free-page residue.
		while IFS= read -r hit; do
			echo "CREDENTIAL RESIDUE: $hit (pattern: $pattern)" >&2
			status=1
		done < <(grep -rnIE "$pattern" "$dir" \
			--include='*.log' --include='*.json' --include='*.txt' \
			--include='*.vscdb' --include='*.db' --include='argv.json' \
			2>/dev/null | cut -c1-200 || true)
		while IFS= read -r db; do
			if strings "$db" | grep -E "$pattern" >/dev/null 2>&1; then
				echo "CREDENTIAL RESIDUE (binary scan): $db (pattern: $pattern)" >&2
				status=1
			fi
		done < <(find "$dir" -name '*.vscdb' -o -name '*.db' 2>/dev/null || true)
	done
done

if [ "$status" -eq 0 ]; then
	echo "credential residue scan: clean ($*)"
fi
exit "$status"
