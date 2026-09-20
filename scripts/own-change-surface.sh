#!/usr/bin/env bash
# Own-change-surface statistics (D14 / Issue #16, acceptance 10).
#
# Measures the fork's own delta relative to the pinned upstream baseline
# (UPSTREAM_COMMIT): file counts, line churn, and the overlay vs source-change
# split -- the number that must stay small for rebases to remain cheap (R2).
#
# Also carries the D09 (Issue #11) acceptance-12 "0 patches" assertion forward:
# the grok-code-product overlay workflow allowed up to 5 files under patches/;
# this fork's in-tree route (D17) commits to ZERO patch files -- every custom
# change is either an overlay (product/ mixin, CI, docs, scripts, new additive
# modules) or a justified in-tree source edit tracked in UPSTREAM-SYNC.md section 4.
#
# Usage: bash scripts/own-change-surface.sh [--baseline <commit>]
# Exit: 0 always for the stats; non-zero if patch files under patches/ exist.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASELINE=""
if [ "${1:-}" = "--baseline" ]; then BASELINE="${2:?--baseline needs a value}"; fi
if [ -z "$BASELINE" ]; then
	BASELINE="$(tr -d '[:space:]' < UPSTREAM_COMMIT)"
fi
if ! git cat-file -e "$BASELINE^{commit}" 2>/dev/null; then
	git fetch --no-tags --filter=blob:none origin "$BASELINE"
fi

# Two-dot diff against the pin: the pin is an ancestor of HEAD, so this is
# exactly the fork's own delta.
SHORTSTAT="$(git diff --shortstat "$BASELINE" HEAD -- . || true)"
ADDED_FILES="$(git diff --name-only --diff-filter=A "$BASELINE" HEAD | grep -c . || true)"
MODIFIED_FILES="$(git diff --name-only --diff-filter=M "$BASELINE" HEAD | grep -c . || true)"
DELETED_FILES="$(git diff --name-only --diff-filter=D "$BASELINE" HEAD | grep -c . || true)"
RENAMED_FILES="$(git diff --name-only --diff-filter=R "$BASELINE" HEAD | grep -c . || true)"
TOTAL_FILES=$((ADDED_FILES + MODIFIED_FILES + DELETED_FILES + RENAMED_FILES))
NUMSTAT_TOTAL="$(git diff --numstat "$BASELINE" HEAD | awk '{a+=$1; d+=$2} END {printf "%d insertions(+), %d deletions(-)", a, d}')"

# Overlay = additive files that cannot collide with upstream on merge by
# construction (they did not exist upstream). Source change = M/D/R against
# files upstream also ships.
SRC_DIRS="$(git diff --name-only --diff-filter=M "$BASELINE" HEAD -- src build extensions | grep -c . || true)"

# D09 AC12: patches/ must not exist (or be empty apart from .gitkeep).
PATCH_COUNT=0
if [ -d patches ]; then
	PATCH_COUNT="$(find patches -type f ! -name '.gitkeep' | grep -c . || true)"
fi

echo "== Own-change surface vs upstream baseline ${BASELINE:0:12} =="
echo "commits ahead of pin:      $(git rev-list --count "$BASELINE"..HEAD)"
echo "files changed (total):     $TOTAL_FILES"
echo "  added   (overlay-class): $ADDED_FILES"
echo "  modified (source-class): $MODIFIED_FILES  (of which under src/,build/,extensions/: $SRC_DIRS)"
echo "  deleted:                 $DELETED_FILES"
echo "  renamed:                 $RENAMED_FILES"
echo "line churn:                $NUMSTAT_TOTAL"
echo "shortstat:                 ${SHORTSTAT:-no diff}"
echo "patches/ entries:          $PATCH_COUNT"

if [ "$PATCH_COUNT" -gt 0 ]; then
	echo "FAIL: $PATCH_COUNT patch file(s) under patches/ -- D09 AC12 requires 0 (use the product/ mixin or a justified in-tree edit instead)." >&2
	exit 1
fi
echo "OK: 0 patch files -- D09 AC12 invariant holds."
