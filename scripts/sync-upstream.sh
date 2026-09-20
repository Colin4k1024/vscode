#!/usr/bin/env bash
# Sync this fork with upstream microsoft/vscode (fork-merge semantics).
#
# Ported from grok-code-product scripts/sync-upstream.sh (D17 route decision section 4,
# item 9, "reuse with modifications"). Differences from the original overlay/patch version:
#   (a) step 3 is `git merge` of an upstream ref (in-tree fork), not `git apply`
#       of a patches/ directory;
#   (b) conflict detection uses the real merge result (`git merge-tree` in
#       --dry-run, the merge exit code + unmerged index entries otherwise) --
#       the original's `git diff --diff-filter=U` check was a no-op under
#       `git apply` because apply never produces unmerged index entries;
#   (c) the grok-code-extension follow-up step is dropped (D17 section 9).
#
# Usage:
#   bash scripts/sync-upstream.sh [--ref <upstream-ref>] [--dry-run]
#
#   --ref       Upstream ref to merge (default: upstream/main). Any commit-ish
#               resolvable after the fetch step, e.g. a release tag like 1.139.0.
#   --dry-run   Do not touch the working tree, the index, UPSTREAM_COMMIT, or
#               branches. Fetches the ref (unless --no-fetch) and reports the
#               would-be merge result, including the conflicted file list.
#   --no-fetch  Skip the fetch step (use already-local refs; useful offline).
#
# Exit codes: 0 = clean merge (or clean dry-run), 1 = conflicts / usage error,
#             2 = preflight failure.
#
# This script NEVER pushes. The rebase/merge runbook lives in UPSTREAM-SYNC.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/microsoft/vscode.git"
REF="upstream/main"
DRY_RUN=0
DO_FETCH=1

while [ $# -gt 0 ]; do
	case "$1" in
		--ref) REF="${2:?--ref needs a value}"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		--no-fetch) DO_FETCH=0; shift ;;
		-h|--help)
			sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done


# Fetches the upstream remote. blob:none keeps the fetch small (merge/diff
# lazily fetches the few blobs it needs). --shallow-since is used ONLY when the
# local repo is already shallow (CI checkouts) -- on a full clone it would
# truncate local history by writing a shallow boundary, which we must not do.
fetch_upstream() {
	local since
	since="$(git show -s --format=%cI "${1:-$CURRENT_PIN}" 2>/dev/null | cut -dT -f1 || true)"
	if [ "$(git rev-parse --is-shallow-repository)" = "true" ] && [ -n "$since" ]; then
		git fetch --no-tags --filter=blob:none --shallow-since="$since" "$UPSTREAM_REMOTE" || \
			git fetch --no-tags "$UPSTREAM_REMOTE"
	else
		git fetch --no-tags --filter=blob:none "$UPSTREAM_REMOTE" || \
			git fetch --no-tags "$UPSTREAM_REMOTE"
	fi
}

if [ ! -f UPSTREAM_COMMIT ]; then
	echo "ERROR: UPSTREAM_COMMIT pin file missing at repo root (see UPSTREAM-SYNC.md)." >&2
	exit 2
fi
CURRENT_PIN="$(tr -d '[:space:]' < UPSTREAM_COMMIT)"

echo "==> Syncing fork with upstream (current pin: ${CURRENT_PIN:0:12})"
[ "$DRY_RUN" -eq 1 ] && echo "    mode: DRY-RUN (no working-tree, index, branch, or pin changes)"

# Step 1: fetch upstream
if [ "$DO_FETCH" -eq 1 ]; then
	echo "[1/6] Fetching upstream..."
	if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
		git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
		echo "    added remote: $UPSTREAM_REMOTE -> $UPSTREAM_URL"
	fi
	fetch_upstream "$CURRENT_PIN"
else
	echo "[1/6] Fetch skipped (--no-fetch)."
fi

TARGET="$REF"
if ! git rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null; then
	echo "ERROR: ref '$TARGET' is not resolvable. Fetch it first or pass --ref." >&2
	exit 2
fi
TARGET_SHA="$(git rev-parse "$TARGET^{commit}")"
echo "    target: $TARGET = ${TARGET_SHA:0:12} ($(git show -s --format=%cI "$TARGET_SHA" | cut -dT -f1))"

if git merge-base --is-ancestor "$TARGET_SHA" HEAD; then
	echo "==> $TARGET is already fully merged into HEAD; nothing to do."
	echo "    UPSTREAM_COMMIT stays at ${CURRENT_PIN:0:12}."
	exit 0
fi

# Preflight (real mode only): refuse a dirty working tree — merging into an
# unclean checkout muddies conflict and commit boundaries.
if [ "$DRY_RUN" -eq 0 ]; then
	if ! git diff --quiet || ! git diff --cached --quiet; then
		echo "ERROR: working tree or index is dirty; commit or stash before syncing." >&2
		exit 2
	fi
fi

# Step 2: create the sync branch (real mode only)
BRANCH="sync-upstream/$(git show -s --format=%cd --date=format:%Y%m%d "$TARGET_SHA")-${TARGET_SHA:0:9}"
if [ "$DRY_RUN" -eq 0 ]; then
	echo "[2/6] Creating sync branch $BRANCH ..."
	if git rev-parse --verify --quiet "refs/heads/$BRANCH" > /dev/null; then
		echo "ERROR: sync branch $BRANCH already exists; delete it or pass a different ref." >&2
		exit 2
	fi
	git checkout -b "$BRANCH"
else
	echo "[2/6] (dry-run) would create sync branch $BRANCH"
fi

# Step 3+5: merge (fork-merge semantics) and collect the real conflict list.
# Dry-run uses `git merge-tree --write-tree` (git >= 2.38): computes the merge
# result purely in the object database, without touching the working tree.
CONFLICTS=""
if [ "$DRY_RUN" -eq 1 ]; then
	echo "[3/6] (dry-run) computing would-be merge of $TARGET into HEAD..."
	MT_OUT="$(mktemp -t sync-upstream-merge-tree)"
	if git merge-tree --write-tree HEAD "$TARGET_SHA" > "$MT_OUT"; then
		echo "[5/6] No conflicts: the merge would apply cleanly."
	else
		# merge-tree --write-tree conflict entries: "<mode> <oid> <stage>\t<path>"
		# Collect by path across ALL stages: add/add and rename/rename
		# conflicts have no stage-1 (base) entry, so filtering for stage 1 would
		# miss them. The exit code above is the authoritative conflict signal;
		# this list is for display only (paths may contain spaces, so split on tab).
		CONFLICTS="$(awk -F '\t' 'NF > 1 {print $2}' "$MT_OUT" | sort -u)"
		echo "[5/6] CONFLICTS: $(printf '%s\n' "$CONFLICTS" | grep -c .) file(s) would conflict:"
		printf '%s\n' "$CONFLICTS" | sed 's/^/        /'
		echo "        (conflict hot zones are listed in UPSTREAM-SYNC.md section 3)"
	fi
	rm -f "$MT_OUT"
else
	echo "[3/6] Merging $TARGET (no-commit, no-ff)..."
	set +e
	git merge --no-commit --no-ff "$TARGET_SHA"
	MERGE_RC=$?
	set -e
	if [ "$MERGE_RC" -ne 0 ]; then
		CONFLICTS="$(git diff --name-only --diff-filter=U)"
		echo "[5/6] CONFLICTS: $(printf '%s\n' "$CONFLICTS" | grep -c .) file(s) need manual resolution:"
		printf '%s\n' "$CONFLICTS" | sed 's/^/        /'
		echo "        Resolve, then: git add -A && git commit"
		echo "        Abort with:  git merge --abort"
	else
		echo "[5/6] Merge applied cleanly (staged, not committed)."
	fi
fi

# Step 4: update the pins (real mode only, and only on a clean merge)
if [ "$DRY_RUN" -eq 0 ] && [ -z "$CONFLICTS" ]; then
	echo "[4/6] Updating UPSTREAM_COMMIT pin..."
	echo "$TARGET_SHA" > UPSTREAM_COMMIT
	git add UPSTREAM_COMMIT
else
	echo "[4/6] (skipped) pin update only happens on a real, clean merge."
fi

# Step 6: summary
echo "[6/6] Sync summary"
echo "    mode:     $([ "$DRY_RUN" -eq 1 ] && echo dry-run || echo real)"
echo "    branch:   $([ "$DRY_RUN" -eq 1 ] && echo "(not created) $BRANCH" || echo "$BRANCH")"
echo "    upstream: $TARGET -> $TARGET_SHA"
echo "    pin:      ${CURRENT_PIN:0:12} -> $( [ "$DRY_RUN" -eq 0 ] && [ -z "$CONFLICTS" ] && echo "${TARGET_SHA:0:12}" || echo "(unchanged)")"
echo ""
echo "Next steps (see UPSTREAM-SYNC.md section 3 for the full rebase runbook):"
echo "  1. Re-apply the product mixin: bash scripts/apply-mixin.sh"
echo "  2. Run the post-merge gates:  UPSTREAM-SYNC.md section 3.3 (compile, hygiene,"
echo "     eslint, agent-host unit tests, replay e2e, check-clean-git-state.sh)"
echo "  3. Refresh the change surface: bash scripts/own-change-surface.sh"
echo "  4. Commit and open a PR. Never push directly to main."

if [ -n "$CONFLICTS" ]; then
	exit 1
fi
echo "==> Done."
