#!/usr/bin/env bash
# Publish agent-SDK tarballs to this repo's GitHub Releases — the default
# self-hosted distribution endpoint (D09 ruling 1).
#
# Layout (matches the default AGENT_SDK_URL_TEMPLATE in bundle-codex-sdk.sh):
#   tag:   agent-sdk-<sdk>-<version>
#   asset: <sdk>-<version>-<sdkTarget>.tgz
#
# Idempotency (same semantics as build/agent-sdk/upload.ts, AC6):
#   - asset absent → upload
#   - asset present with matching sha256 (GitHub asset `digest`) → skip
#   - asset present with different / no digest → FAIL LOUD, never overwrite
#     content-addressed history. Recovery: delete the asset on GitHub and
#     re-run.
#
# Usage:
#   bash scripts/publish-sdk-release.sh [--tarball <path>]... [--dry-run]
#
# With no --tarball, every .build/agent-sdk/tarballs/*.tgz is published.
# Requires: gh CLI authenticated against Colin4k1024/vscode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPO="Colin4k1024/vscode"
DRY_RUN=0
TARBALLS=()
while [ $# -gt 0 ]; do
	case "$1" in
		--tarball) TARBALLS+=("${2:?--tarball needs a value}"); shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		-h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v gh >/dev/null 2>&1 || fail "gh CLI not found — install and authenticate (gh auth login) first"

if [ "${#TARBALLS[@]}" -eq 0 ]; then
	while IFS= read -r f; do TARBALLS+=("$f"); done < <(ls .build/agent-sdk/tarballs/*.tgz 2>/dev/null || true)
fi
[ "${#TARBALLS[@]}" -gt 0 ] || fail "no tarballs to publish (looked in .build/agent-sdk/tarballs/)"

for TGZ in "${TARBALLS[@]}"; do
	[ -f "$TGZ" ] || fail "tarball not found: $TGZ"
	BASE="$(basename "$TGZ")"
	# <sdk>-<version>-<sdkTarget>.tgz — same convention as upload.ts's CLI.
	if [[ ! "$BASE" =~ ^([a-z]+)-([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)-((darwin|linux|win32)-(x64|arm64)(-musl)?)\.tgz$ ]]; then
		fail "cannot derive (sdk, version, target) from tarball filename '$BASE'"
	fi
	SDK="${BASH_REMATCH[1]}"
	VERSION="${BASH_REMATCH[2]}"
	TAG="agent-sdk-$SDK-$VERSION"
	SHA="$(shasum -a 256 "$TGZ" | awk '{print $1}')"

	echo "==> $BASE"
	echo "    release: $TAG   sha256: $SHA"

	if [ "$DRY_RUN" -eq 1 ]; then
		echo "    [dry-run] would ensure release $TAG and upload $BASE"
		continue
	fi

	if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
		echo "    creating release $TAG"
		gh release create "$TAG" --repo "$REPO" \
			--title "Agent SDK: $SDK $VERSION" \
			--notes "Self-hosted agent SDK tarballs for ColinCode $SDK $VERSION (D09). Content-addressed; assets are immutable once published."
	fi

	EXISTING_DIGEST="$(gh release view "$TAG" --repo "$REPO" --json assets \
		--jq ".assets[] | select(.name == \"$BASE\") | .digest // \"\"" || true)"

	if [ -n "$EXISTING_DIGEST" ]; then
		REMOTE_SHA="${EXISTING_DIGEST#sha256:}"
		if [ "$REMOTE_SHA" = "$SHA" ]; then
			echo "    asset already present with matching sha256 — skipping (idempotent)"
			continue
		fi
		fail "asset $BASE already present in $TAG with DIFFERENT digest ($EXISTING_DIGEST vs local sha256:$SHA) — refusing to overwrite content-addressed history. Delete the asset on GitHub and re-run, or investigate the byte drift."
	fi

	# Digest missing from the API response is not proof of absence: verify
	# via the asset list before uploading.
	if gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' | grep -qx "$BASE"; then
		fail "asset $BASE exists in $TAG but its digest could not be read — refusing to overwrite. Delete the asset on GitHub and re-run."
	fi

	echo "    uploading $(stat -f%z "$TGZ") bytes"
	gh release upload "$TAG" "$TGZ" --repo "$REPO"
	echo "    ✓ uploaded"
done
