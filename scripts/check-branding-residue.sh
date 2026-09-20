#!/usr/bin/env bash
# AC8 (Issue #8): scan a packaged product (or any directory) for user-visible
# branding residue of the upstream product identity.
#
# Usage:
#   bash scripts/check-branding-residue.sh <path-to-packaged-app-or-dir>
#
# Matches "Visual Studio Code", "Code - OSS", "code-oss" (case-insensitive
# where meaningful) in text files. Matches on lines that also match a pattern
# in product/branding-residue-whitelist.txt (one grep -E pattern per line) are
# exempt — that whitelist is ONLY for third-party license/copyright texts that
# legitimately reference the upstream project.
#
# Exit code is non-zero if any non-whitelisted residue is found.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WHITELIST="$REPO_ROOT/product/branding-residue-whitelist.txt"
TARGET="${1:-}"

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$TARGET" ] || fail "usage: $0 <path-to-packaged-app-or-dir>"
[ -d "$TARGET" ] || fail "not a directory: $TARGET"
[ -f "$WHITELIST" ] || fail "whitelist not found: $WHITELIST"

# Binaries / images are skipped: grep -I ignores binary files.
PATTERN='Visual Studio Code|Code - OSS|code-oss|code\.visualstudio\.com'

hits=$(grep -rInE "$PATTERN" "$TARGET" 2>/dev/null || true)

if [ -z "$hits" ]; then
	echo "branding residue scan: PASS (no matches in $TARGET)"
	exit 0
fi

# Filter whitelisted lines (patterns are matched against the whole grep hit line).
whitelist_patterns=$(grep -vE '^\s*(#|$)' "$WHITELIST" || true)
residue=""
if [ -n "$whitelist_patterns" ]; then
	residue=$(echo "$hits" | grep -vE "$whitelist_patterns" || true)
else
	residue="$hits"
fi

whitelisted_count=$(( $(echo "$hits" | grep -c '') - $( [ -n "$residue" ] && echo "$residue" | grep -c '' || echo 0 ) ))

if [ -n "$residue" ]; then
	echo "ERROR: branding residue found in $TARGET (non-whitelisted):" >&2
	echo "$residue" | head -100 >&2
	count=$(echo "$residue" | grep -c '')
	[ "$count" -le 100 ] || echo "... and $((count - 100)) more" >&2
	exit 1
fi

echo "branding residue scan: PASS (${whitelisted_count} whitelisted third-party/license reference(s))"
