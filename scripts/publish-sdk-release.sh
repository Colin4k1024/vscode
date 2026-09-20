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
# With no --tarball, every results.json-referenced .build/agent-sdk/tarballs/*.tgz
# is published (tarballs not referenced by results.json — e.g. left over from an
# older SDK version — are skipped, never published: they would create/update a
# release tag nothing consumes, M5). Every published tarball's sha256 is compared
# against the hash results.json records for its (sdk, target) — the value baked
# into product.json — so a drifted tarball fails the publish instead of shipping
# bytes the runtime will reject (M6).
# Requires: gh CLI authenticated against Colin4k1024/vscode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPO="Colin4k1024/vscode"
RESULTS_FILE="$REPO_ROOT/.build/agent-sdk/results.json"
DRY_RUN=0
EXPLICIT=0
TARBALLS=()
while [ $# -gt 0 ]; do
	case "$1" in
		--tarball) TARBALLS+=("${2:?--tarball needs a value}"); EXPLICIT=1; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		-h|--help) sed -n '2,29p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v gh >/dev/null 2>&1 || fail "gh CLI not found — install and authenticate (gh auth login) first"

# Look up the sha256 results.json records for (sdk, target). Prints the hash,
# or nothing when the results file is absent / has no such entry.
results_sha() {
	node - "$RESULTS_FILE" "$1" "$2" <<'NODE_EOF'
const fs = require('fs');
const [resultsFile, sdk, target] = process.argv.slice(2);
try {
	const entry = JSON.parse(fs.readFileSync(resultsFile, 'utf8'))[sdk];
	process.stdout.write(entry?.sha256ByTarget?.[target] ?? entry?.sha256 ?? '');
} catch { /* no results file — caller warns */ }
NODE_EOF
}

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
	TARGET="${BASH_REMATCH[4]}"
	TAG="agent-sdk-$SDK-$VERSION"
	SHA="$(shasum -a 256 "$TGZ" | awk '{print $1}')"

	# M5/M6: only publish what results.json references, and only when the
	# bytes match the hash product.json was (or will be) stamped with.
	RECORDED="$(results_sha "$SDK" "$TARGET")"
	if [ -f "$RESULTS_FILE" ]; then
		if [ -z "$RECORDED" ]; then
			if [ "${EXPLICIT:-0}" = "1" ]; then
				fail "$BASE is not referenced by $RESULTS_FILE for sdk '$SDK' target '$TARGET' — refusing to publish a tarball product.json does not point at. Re-run bundle-codex-sdk.sh for this target, or delete the stale tarball."
			fi
			echo "==> $BASE"
			echo "    not referenced by results.json — skipping (stale tarball; see M5)"
			continue
		fi
		if [ "$RECORDED" != "$SHA" ]; then
			fail "$BASE sha256 mismatch: tarball on disk is $SHA but results.json records $RECORDED — the bytes differ from what product.json points at. Re-run bundle-codex-sdk.sh (its restamp fixes the recorded hash) or restore the matching tarball."
		fi
		echo "    sha256 matches results.json — OK"
	else
		echo "    note: no results.json at $RESULTS_FILE — publishing without the results cross-check"
	fi

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

	echo "    uploading $(wc -c < "$TGZ" | tr -d ' ') bytes"
	gh release upload "$TAG" "$TGZ" --repo "$REPO"
	echo "    ✓ uploaded"
done
