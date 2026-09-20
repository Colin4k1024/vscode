#!/usr/bin/env bash
# AC9 (Issue #8): the upstream product.json must remain 0-diff in git.
# Run BEFORE scripts/apply-mixin.sh (the mixin writes a working-tree merge
# artifact by design). Suitable as a CI gate on the committed tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

stat_out=$(git diff --stat HEAD -- product.json)
porcelain=$(git status --porcelain -- product.json)

if [ -n "$stat_out" ] || [ -n "$porcelain" ]; then
	echo "ERROR: product.json differs from git HEAD — the mixin must be a working-tree-only overlay." >&2
	echo "$stat_out$porcelain" >&2
	exit 1
fi
echo "product.json pristine: OK (0 diff vs HEAD)"
