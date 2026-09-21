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
# Portable file size (review #66, L3): this script runs on the CI publish
# job's ubuntu runners, where BSD `stat -f%z` does not exist.
filesize() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }
command -v gh >/dev/null 2>&1 || fail "gh CLI not found — install and authenticate (gh auth login) first"

if [ "${#TARBALLS[@]}" -eq 0 ]; then
	while IFS= read -r f; do TARBALLS+=("$f"); done < <(ls .build/agent-sdk/tarballs/*.tgz 2>/dev/null || true)
	# Review #66 (M5): the tarballs dir is never cleaned, so publishing
	# everything found would let a stale tarball from a previous SDK bump
	# create/update its own release tag. When a results file exists, only
	# publish tarballs whose <sdk>-<version> it records.
	RESULTS_FILE="${AGENT_SDK_RESULTS_FILE:-$REPO_ROOT/.build/agent-sdk/results.json}"
	if [ -f "$RESULTS_FILE" ] && [ "${#TARBALLS[@]}" -gt 0 ]; then
		FILTERED=()
		while IFS= read -r f; do FILTERED+=("$f"); done < <(node - "$RESULTS_FILE" "${TARBALLS[@]}" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const [resultsFile, ...tarballs] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const versions = new Set(Object.entries(results).map(([sdk, e]) => `${sdk}-${e.version}`));
for (const t of tarballs) {
	const m = /^([a-z]+-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)-(?:darwin|linux|win32)-(?:x64|arm64)(?:-musl)?\.tgz$/.exec(path.basename(t));
	if (m && versions.has(m[1])) {
		console.log(t);
	} else {
		console.error(`    skipping stale/foreign tarball: ${path.basename(t)}`);
	}
}
NODE_EOF
)
		TARBALLS=(${FILTERED[@]+"${FILTERED[@]}"})
	fi
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

	# Review #66 (M6): the hash baked into product.json comes from the
	# results file; publishing bytes that differ from it would ship a
	# release every runtime launch rejects. Fail BEFORE creating the tag.
	RESULTS_FILE="${AGENT_SDK_RESULTS_FILE:-$REPO_ROOT/.build/agent-sdk/results.json}"
	if [ -f "$RESULTS_FILE" ]; then
		node - "$RESULTS_FILE" "$SDK" "$VERSION" "$BASE" "$SHA" <<'NODE_EOF'
const fs = require('fs');
const [resultsFile, sdk, version, base, sha] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const entry = results[sdk];
if (!entry || entry.version !== version) {
	console.error(`ERROR: results file ${resultsFile} has no entry for ${sdk} ${version} — refusing to publish bytes product.json does not know about`);
	process.exit(1);
}
const target = base.replace(/\.tgz$/, '').slice(`${sdk}-${version}-`.length);
const expected = entry.sha256ByTarget?.[target] ?? (entry.sha256ByTarget ? undefined : entry.sha256);
if (expected === undefined) {
	console.error(`ERROR: results file has no recorded hash for target ${target} — refusing to publish unrecorded bytes`);
	process.exit(1);
}
if (expected !== sha) {
	console.error(`ERROR: tarball sha256 (${sha}) != results-file hash (${expected}) for ${target} — the bytes differ from what product.json will verify; re-run the bundle step`);
	process.exit(1);
}
console.log(`    ✓ tarball sha matches the results-file hash for ${target}`);
NODE_EOF
	fi

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

	echo "    uploading $(filesize "$TGZ") bytes"
	gh release upload "$TAG" "$TGZ" --repo "$REPO"
	echo "    ✓ uploaded"
done
