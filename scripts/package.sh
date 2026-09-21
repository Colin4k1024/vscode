#!/usr/bin/env bash
# One-command local packaging pipeline (D09 #11 AC1):
#
#   bash scripts/package.sh
#
# Chain: product-json pristine gate → apply-mixin → bundle-codex-sdk →
# gulp vscode-<platform>-<arch>-min → beta gates on the artifact →
# zip + SHA256SUMS manifest.
#
# Ported from grok-code-product scripts/build.sh + scripts/package.sh
# (D17 section 4 — adapted for reuse; their signing/notarization steps are deliberately
# NOT ported: D09 ruling 3 — first version ships unsigned, see the known
# limitations printed at the end).
#
# Usage:
#   scripts/package.sh [--platform=<darwin>] [--arch=<arm64>]
#                      [--skip-sdk] [--skip-gates] [--skip-zip]
#
# Outputs:
#   ../VSCode-<platform>-<arch>/            the packaged app (gulp output)
#   .build/dist/<name>-<version>-<platform>-<arch>.zip
#   .build/dist/SHA256SUMS.txt              sha256 manifest (app zip + SDK tarballs)
#   .build/agent-sdk/tarballs/*.tgz         self-hostable SDK tarballs
#   .build/agent-sdk/results.json           product.agentSdks stamping input
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PLATFORM="darwin"
ARCH="arm64"
SKIP_SDK=0
SKIP_GATES=0
SKIP_ZIP=0
while [ $# -gt 0 ]; do
	case "$1" in
		--platform=*) PLATFORM="${1#*=}"; shift ;;
		--arch=*) ARCH="${1#*=}"; shift ;;
		--skip-sdk) SKIP_SDK=1; shift ;;
		--skip-gates) SKIP_GATES=1; shift ;;
		--skip-zip) SKIP_ZIP=1; shift ;;
		-h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
# Portable file size (review #66, L3): GNU stat uses -c%s, BSD stat -f%z —
# hard-coding the BSD form breaks the publish job's ubuntu runners.
filesize() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH (use node@24: export PATH=/opt/homebrew/opt/node@24/bin:\$PATH)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "node >= 22 required, got $(node --version)"
[ -d node_modules ] || fail "node_modules missing — run npm ci first"
if [ -n "${AGENT_SDK_RESULTS_FILE:-}" ]; then
	fail "AGENT_SDK_RESULTS_FILE is already set in the environment — package.sh manages it; unset and retry"
fi

# Built-in extensions (js-debug etc.) are downloaded via the GitHub API,
# which rate-limits anonymous callers to 60 req/hr — the packaging build
# exceeds that on retries. Use a token when one is available.
if [ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
	if TOKEN="$(gh auth token 2>/dev/null)" && [ -n "$TOKEN" ]; then
		export GITHUB_TOKEN="$TOKEN"
		echo "    using gh CLI token for GitHub API (built-in extension downloads)"
	fi
fi

# Build-environment self-heal: node 24's global fetch (undici) uses happy
# eyeballs; on networks with a broken IPv6 route to github.com the API call
# that downloads built-in extensions (js-debug etc.) fails with
# "TypeError: fetch failed". Probe once; if it fails, disable family
# autoselection for the gulp child processes.
if ! node -e "fetch('https://api.github.com/',{signal:AbortSignal.timeout(10000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
	echo "    note: direct fetch to api.github.com failed — disabling network family autoselection for this build"
	# NB: a leading space in NODE_OPTIONS silently neutralizes the flag.
	export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-network-family-autoselection"
fi

# The full extension compile + esbuild bundle OOMs node's default ~4GB heap
# (observed: Ineffective mark-compacts near heap limit at ~4.1GB during
# bundle-non-native-extensions-build). 32GB cap — node only commits what it needs (dev machines have the headroom; CI runners peak lower because their node_modules are real dirs, not the symlinked overlay used locally).
case " ${NODE_OPTIONS:-} " in
	*" --max-old-space-size"*) ;;
	# 16GB cap: 4x the observed ~4.1GB peak, and within a 16GB CI runner's
	# RAM (review #66, L7 — the previous 32GB cap exceeded the machine).
	*) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=16384" ;;
esac

DIST_DIR="$REPO_ROOT/.build/dist"
RESULTS_FILE="$REPO_ROOT/.build/agent-sdk/results.json"
mkdir -p "$DIST_DIR"

echo "==> [1/6] product.json pristine gate"
if [ -z "$(git status --porcelain -- product.json)" ]; then
	bash scripts/check-product-json-pristine.sh
elif bash scripts/apply-mixin.sh --check >/dev/null 2>&1; then
	echo "    product.json already has the mixin applied (idempotent re-run) — OK"
else
	fail "product.json is dirty but is NOT the applied mixin — run: git checkout -- product.json resources/"
fi

echo "==> [2/6] apply product mixin"
bash scripts/apply-mixin.sh

if [ "$SKIP_SDK" -eq 0 ]; then
	echo "==> [3/6] bundle Codex agent SDK"
	bash scripts/bundle-codex-sdk.sh --target="$PLATFORM-$ARCH"
else
	echo "==> [3/6] bundle Codex agent SDK — SKIPPED (--skip-sdk)"
	[ -f "$RESULTS_FILE" ] || fail "--skip-sdk given but no prior results file at $RESULTS_FILE"
	# Issue #66 (H1): a bare existence check accepts ANY stale results file.
	# Assert the recorded SDK version still matches the pinned npm dependency
	# and that the integrity hash covers the target being packaged.
	node - "$RESULTS_FILE" "$PLATFORM-$ARCH" <<'NODE_EOF'
const fs = require('fs');
const [resultsFile, target] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
for (const [sdk, entry] of Object.entries(results)) {
	const pinned = JSON.parse(fs.readFileSync(`build/agent-sdk/agents/${sdk}/package.json`, 'utf8'));
	const pinnedVersion = pinned.dependencies[Object.keys(pinned.dependencies)[0]];
	if (entry.version !== pinnedVersion) {
		console.error(`ERROR: --skip-sdk: results file records ${sdk} ${entry.version} but the pinned dependency is ${pinnedVersion} — the results file is stale; re-run the bundle step (drop --skip-sdk)`);
		process.exit(1);
	}
	if (entry.sha256ByTarget !== undefined) {
		if (!entry.sha256ByTarget[target]) {
			console.error(`ERROR: --skip-sdk: results file has no sha256 for target ${target} (have: ${Object.keys(entry.sha256ByTarget).join(', ') || '<none>'}) — bundle that target first (drop --skip-sdk)`);
			process.exit(1);
		}
	} else if (!entry.sha256) {
		console.error(`ERROR: --skip-sdk: results file entry for ${sdk} carries no integrity hash at all — re-run the bundle step`);
		process.exit(1);
	}
	console.log(`    results file verified: ${sdk} ${entry.version}, target ${target} covered`);
}
NODE_EOF
fi
# The local/GHA equivalent of Azure's `##vso[task.setvariable ...]` handoff:
# gulp's packageTask reads this env var and stamps product.agentSdks.
export AGENT_SDK_RESULTS_FILE="$RESULTS_FILE"

echo "==> [4/6] gulp vscode-$PLATFORM-$ARCH-min (this is the long step: 20-60 min)"
# The built-in-extension download step fetches 3 VSIXes from the GitHub API
# with no on-disk cache; on flaky networks one hanging connection fails the
# whole hour-long build. Retry the full task a bounded number of times —
# every step in it is idempotent (clean-extensions → re-download → rebuild).
GULP_ATTEMPT=0
while true; do
	GULP_ATTEMPT=$((GULP_ATTEMPT + 1))
	if npx gulp "vscode-$PLATFORM-$ARCH-min"; then
		break
	fi
	if [ "$GULP_ATTEMPT" -ge 3 ]; then
		fail "gulp vscode-$PLATFORM-$ARCH-min failed after $GULP_ATTEMPT attempts"
	fi
	echo "    gulp attempt $GULP_ATTEMPT failed — retrying (attempt $((GULP_ATTEMPT + 1))/3)…"
	sleep 10
done

# gulp writes the packaged app next to the repo root.
APP_PARENT="$(dirname "$REPO_ROOT")"
APP_OUT="$APP_PARENT/VSCode-$PLATFORM-$ARCH"
[ -d "$APP_OUT" ] || fail "expected gulp output missing: $APP_OUT"
APP_NAME_LONG="$(node -p "JSON.parse(require('fs').readFileSync('product.json','utf8')).nameLong")"
APP_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
if [ "$PLATFORM" = "darwin" ]; then
	APP_PATH="$APP_OUT/$APP_NAME_LONG.app"
else
	APP_PATH="$APP_OUT"
fi
[ -e "$APP_PATH" ] || fail "expected app missing: $APP_PATH"

echo "==> [5/6] beta gates on the packaged artifact"
if [ "$SKIP_GATES" -eq 0 ]; then
	bash scripts/verify-beta-gates.sh --app "$APP_PATH"
else
	echo "    SKIPPED (--skip-gates)"
fi

echo "==> [6/6] archive + sha256 manifest"
SAFE_NAME="$(echo "$APP_NAME_LONG" | tr -d ' ' | tr '[:upper:]' '[:lower:]')"
ZIP="$DIST_DIR/$SAFE_NAME-$APP_VERSION-$PLATFORM-$ARCH.zip"
if [ "$SKIP_ZIP" -eq 0 ]; then
	rm -f "$ZIP"
	if [ "$PLATFORM" = "darwin" ]; then
		# ditto preserves macOS metadata/symlinks the way Finder's Compress does.
		ditto -c -k --keepParent "$APP_PATH" "$ZIP"
	else
		(cd "$APP_OUT" && zip -q -r -y "$ZIP" .)
	fi
	echo "    zip: $ZIP ($(filesize "$ZIP") bytes)"
fi

SUMS="$DIST_DIR/SHA256SUMS.txt"
# Bare filenames, verifiable via `shasum -a 256 -c SHA256SUMS.txt` from the
# manifest's own directory (review #66, L6): repo-root-relative paths broke
# verification against the flattened CI artifact, and absolute paths (LOW-2)
# bake the builder's home directory into a published artifact.
{
	if [ "$SKIP_ZIP" -eq 0 ]; then
		(cd "$DIST_DIR" && shasum -a 256 "$(basename "$ZIP")")
	fi
} > "$SUMS"
echo "    manifest: $SUMS"
cat "$SUMS"

# SDK tarball manifest lives next to the tarballs so the (separately
# flattened) tarballs artifact stays self-verifiable. Only tarballs whose
# version the results file actually records are listed (review #66, M5) —
# a stale tarball from a previous SDK bump must not sail into a manifest.
TARBALLS_DIR="$REPO_ROOT/.build/agent-sdk/tarballs"
TGZ_SUMS="$TARBALLS_DIR/SHA256SUMS.txt"
if [ -f "$RESULTS_FILE" ]; then
	node - "$RESULTS_FILE" "$TARBALLS_DIR" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [resultsFile, tarballsDir] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const versions = new Set(Object.entries(results).map(([sdk, e]) => `${sdk}-${e.version}`));
const lines = [];
for (const f of fs.readdirSync(tarballsDir).filter(f => f.endsWith('.tgz')).sort()) {
	// <sdk>-<version>-<sdkTarget>.tgz — match the <sdk>-<version> prefix.
	const m = /^([a-z]+-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)-(?:darwin|linux|win32)-(?:x64|arm64)(?:-musl)?\.tgz$/.exec(f);
	if (!m || !versions.has(m[1])) {
		console.log(`    skipping stale/foreign tarball: ${f}`);
		continue;
	}
	const sha = execFileSync('shasum', ['-a', '256', path.join(tarballsDir, f)], { encoding: 'utf8' }).split(/\s+/)[0];
	lines.push(`${sha}  ${f}`);
}
fs.writeFileSync(path.join(tarballsDir, 'SHA256SUMS.txt'), lines.join('\n') + (lines.length ? '\n' : ''));
console.log(`    tarball manifest: ${path.join(tarballsDir, 'SHA256SUMS.txt')} (${lines.length} entries)`);
NODE_EOF
fi

cat <<-EOT

================================================================
BUILD COMPLETE
app:      $APP_PATH
zip:      $([ "$SKIP_ZIP" -eq 0 ] && echo "$ZIP" || echo "(skipped)")
manifest: $SUMS

Known limitations (D09 ruling 3, recorded per AC11):
* UNSIGNED / NOT NOTARIZED: first launch on macOS requires
right-click > Open, or: xattr -d com.apple.quarantine "<app>"
* Windows builds would trigger SmartScreen (no Authenticode).
* No auto-update feed; updates are manual re-installs.
* SDK tarballs are NOT uploaded by this script. Publish them with:
bash scripts/publish-sdk-release.sh
until then the urlTemplate stamped into product.agentSdks resolves 404.
* COPILOT/CAPI-BACKED PATHS UNAVAILABLE (Issue #66, M3 — declared
regression): excludeCopilotFromPackaging removes @vscode/copilot-api
(D10 section 5). The branded build hides the Copilot sign-in entry
(chatSetupHidden + the agent host does not list the Copilot resource),
never starts the CAPI proxy, and short-circuits the Copilot model
catalog; PR/commit message generation fails with a user-facing
"not available in this build" error.
================================================================
EOT
