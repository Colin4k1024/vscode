#!/usr/bin/env bash
# AC8 (Issue #8): scan a packaged product (or any directory) for user-visible
# branding residue of the upstream product identity.
#
# Usage:
#   bash scripts/check-branding-residue.sh <path-to-packaged-app-or-dir>
#
# Matches "Visual Studio Code", "Code - OSS", "code-oss" (case-insensitive
# where meaningful) in text files. A hit is exempt only when it matches an
# entry in product/branding-residue-whitelist.txt — entries are COMPOUND:
# <path-regex><TAB><content-regex>, and both the hit's file path (relative to
# the scanned root) and its line content must match (D06 round-1, M2:
# content-only whitelisting let first-party files like README.txt smuggle
# upstream brand references through by merely containing the word "license").
#
# Exit code: 0 = clean (or only whitelisted hits); 1 = residue found;
# 2 = usage/config error (incl. malformed whitelist lines).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WHITELIST="$REPO_ROOT/product/branding-residue-whitelist.txt"
TARGET="${1:-}"

fail() { echo "ERROR: $*" >&2; exit 2; }
[ -n "$TARGET" ] || fail "usage: $0 <path-to-packaged-app-or-dir>"
[ -d "$TARGET" ] || fail "not a directory: $TARGET"
[ -f "$WHITELIST" ] || fail "whitelist not found: $WHITELIST"
command -v node >/dev/null 2>&1 || fail "node not found on PATH"

# Binaries / images are skipped: grep -I ignores binary files.
# Paths are made relative to the scanned root so whitelist path anchors are
# stable regardless of where the packaged app sits on disk.
PATTERN='Visual Studio Code|Code - OSS|code-oss|code\.visualstudio\.com'

hits=$(cd "$TARGET" && grep -rInE "$PATTERN" . 2>/dev/null || true)

if [ -z "$hits" ]; then
	echo "branding residue scan: PASS (no matches in $TARGET)"
	exit 0
fi

FILTER_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/branding-residue-filter.XXXXXX.cjs")
trap 'rm -f "$FILTER_SCRIPT"' EXIT
cat > "$FILTER_SCRIPT" <<'NODE_EOF'
const fs = require('fs');
const whitelistPath = process.argv[2];
const entries = [];
fs.readFileSync(whitelistPath, 'utf8').split('\n').forEach((line, i) => {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return;
	}
	const tab = line.indexOf('\t');
	if (tab === -1) {
		console.error(`ERROR: malformed whitelist line ${i + 1} (expected "<path-regex>\\t<content-regex>"): ${line}`);
		process.exit(2);
	}
	entries.push([new RegExp(line.slice(0, tab)), new RegExp(line.slice(tab + 1))]);
});

const hits = fs.readFileSync(0, 'utf8').split('\n').filter(l => l.length > 0);
const residue = [];
let whitelisted = 0;
for (const hit of hits) {
	const m = /^(.+?):(\d+):(.*)$/.exec(hit);
	if (!m) {
		residue.push(hit); // unparseable grep output must not slip through
		continue;
	}
	const [, file, , content] = m;
	if (entries.some(([pathRe, contentRe]) => pathRe.test(file) && contentRe.test(content))) {
		whitelisted++;
	} else {
		residue.push(hit);
	}
}
process.stdout.write(residue.join('\n') + (residue.length ? '\n' : ''));
process.exit(residue.length ? 1 : 0);
NODE_EOF

set +e
residue=$(printf '%s\n' "$hits" | node "$FILTER_SCRIPT" "$WHITELIST")
filter_rc=$?
set -e
if [ "$filter_rc" -eq 2 ]; then
	exit 2
elif [ "$filter_rc" -ne 0 ] && [ "$filter_rc" -ne 1 ]; then
	echo "ERROR: whitelist filter crashed (node exit $filter_rc)" >&2
	exit 2
fi

total=$(printf '%s\n' "$hits" | grep -c '')
residue_count=0
[ -z "$residue" ] || residue_count=$(printf '%s\n' "$residue" | grep -c '')
whitelisted_count=$((total - residue_count))

if [ "$filter_rc" -eq 1 ]; then
	echo "ERROR: branding residue found in $TARGET (non-whitelisted):" >&2
	printf '%s\n' "$residue" | head -100 >&2
	[ "$residue_count" -le 100 ] || echo "... and $((residue_count - 100)) more" >&2
	exit 1
fi

echo "branding residue scan: PASS (${whitelisted_count} whitelisted third-party/license reference(s))"
