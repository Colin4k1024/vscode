#!/usr/bin/env bash
# Upstream drift report (D14 / Issue #16, acceptance 7).
#
# Computes how far upstream microsoft/vscode main has moved since the
# UPSTREAM_COMMIT pin, with per-area diff stats for the fork's conflict hot
# zones. Output is a Markdown report (stdout, or $1 / --out <file>) that the
# codex-upstream-drift.yml workflow uploads as a build artifact; the weekly
# report is the input for rebase prioritization (UPSTREAM-SYNC.md section 5).
#
# Usage:
#   bash scripts/upstream-drift-report.sh [--out <file>] [--ref <upstream-ref>]
#
# Requires network on first run (fetches upstream with a blob:none partial
# clone bounded by --shallow-since=<pin date>). Read-only: never touches the
# working tree or the pin files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/microsoft/vscode.git"
REF="upstream/main"
OUT=""

while [ $# -gt 0 ]; do
	case "$1" in
		--out) OUT="${2:?--out needs a value}"; shift 2 ;;
		--ref) REF="${2:?--ref needs a value}"; shift 2 ;;
		-h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

PIN="$(tr -d '[:space:]' < UPSTREAM_COMMIT)"
VERSION_NOW="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo '?')"


# Fetches the upstream remote. blob:none keeps the fetch small (merge/diff
# lazily fetches the few blobs it needs). --shallow-since is used ONLY when the
# local repo is already shallow (CI checkouts) -- on a full clone it would
# truncate local history by writing a shallow boundary, which we must not do.
fetch_upstream() {
	local since
	since="$(git show -s --format=%cI "${1:-$PIN}" 2>/dev/null | cut -dT -f1 || true)"
	if [ "$(git rev-parse --is-shallow-repository)" = "true" ] && [ -n "$since" ]; then
		git fetch --no-tags --filter=blob:none --shallow-since="$since" "$UPSTREAM_REMOTE" || \
			git fetch --no-tags "$UPSTREAM_REMOTE"
	else
		git fetch --no-tags --filter=blob:none "$UPSTREAM_REMOTE" || \
			git fetch --no-tags "$UPSTREAM_REMOTE"
	fi
}

# Ensure the pin commit is present locally (CI may run on a shallow checkout).
if ! git cat-file -e "$PIN^{commit}" 2>/dev/null; then
	git fetch --no-tags --filter=blob:none origin "$PIN"
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
	git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi
if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
	fetch_upstream
fi
UPSTREAM_SHA="$(git rev-parse "$REF^{commit}")"
UPSTREAM_DATE="$(git show -s --format=%cI "$UPSTREAM_SHA" | cut -dT -f1)"
PIN_DATE="$(git show -s --format=%cI "$PIN" | cut -dT -f1)"

if git merge-base --is-ancestor "$PIN" "$UPSTREAM_SHA" 2>/dev/null; then
	BEHIND="$(git rev-list --count "$PIN..$UPSTREAM_SHA")"
else
	BEHIND="unknown (pin is not an ancestor of $REF -- pin may be off the upstream main line)"
fi

stat_for() { # path...
	local s
	s="$(git diff --shortstat "$PIN" "$UPSTREAM_SHA" -- "$@" 2>/dev/null || true)"
	if [ -z "$s" ]; then echo "0 files changed"; else echo "$s" | sed 's/^ *//'; fi
}

emit_report() {
	cat <<REPORT
# Upstream drift report -- $(date -u +%Y-%m-%dT%H:%M:%SZ)

| | |
|---|---|
| Fork | Colin4k1024/vscode (ColinCode ${VERSION_NOW}) |
| Pinned upstream baseline (\`UPSTREAM_COMMIT\`) | \`${PIN:0:12}\` (${PIN_DATE}) |
| Upstream \`${REF}\` HEAD | \`${UPSTREAM_SHA:0:12}\` (${UPSTREAM_DATE}) |
| Upstream commits since pin | **${BEHIND}** |

## Upstream churn in the fork's hot zones (pin  ${REF})

| Area | Diff stat |
|---|---|
| \`src/vs/platform/agentHost/node/codex/\` | $(stat_for src/vs/platform/agentHost/node/codex) |
| \`src/vs/platform/agentHost/\` (whole) | $(stat_for src/vs/platform/agentHost) |
| \`src/vs/sessions/\` | $(stat_for src/vs/sessions) |
| \`product.json\` | $(stat_for product.json) |
| \`package.json\` | $(stat_for package.json) |
| Whole tree | $(stat_for .) |

## Recent upstream commits in the hot zones

\`\`\`
$(git log --oneline --no-decorate "$PIN..$UPSTREAM_SHA" -- src/vs/platform/agentHost src/vs/sessions 2>/dev/null | head -25 || echo "(history unavailable)")
\`\`\`

## Rebase-priority hint

- Any non-zero churn in \`agentHost/node/codex/\` or \`sessions/\` raises
rebase priority: those are the fork's highest-overlap source-change areas
(see the thin-overlay inventory in UPSTREAM-SYNC.md section 4).
- Churn in \`product.json\` / \`package.json\` collides with the D06 mixin
and the codex version pins; schedule a sync before the next Codex SDK bump.
REPORT
}

if [ -n "$OUT" ]; then
	emit_report > "$OUT"
	echo "Wrote $OUT"
else
	emit_report
fi
