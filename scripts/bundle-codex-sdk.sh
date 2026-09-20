#!/usr/bin/env bash
# Bundle the Codex agent SDK tarball(s) for one platform target and write the
# results JSON that the gulp packageTask stamps into product.agentSdks.
#
# Ported from grok-code-product scripts/bundle-agent.sh (D17 section 4 — adapted for reuse).
# Differences from the source script:
#   * the SDK source is the pinned npm dependency in
#     build/agent-sdk/agents/<sdk>/ (lockfile-deterministic), not a checked-out
#     agent repo — the heavy lifting lives in build/agent-sdk/produce.ts;
#   * the distribution endpoint defaults to THIS REPO's GitHub Releases
#     (D09 ruling 1), not an object-storage CDN;
#   * LICENSE/NOTICE obligations (Apache-2.0, D17 section 4 item 4 / D10 section 2) are
#     fulfilled by injecting the vendored build/agent-sdk/licenses/codex/
#     files into the tarball (the @openai/codex npm packages do not ship
#     their license), then re-packing with the same node-tar portable
#     settings package.ts uses.
#
# Usage:
#   bash scripts/bundle-codex-sdk.sh [--target=<sdkTarget>] [--sdk=<sdk>]
#
#   --target   darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | win32-x64 | win32-arm64
#              (default: derived from the host platform/arch)
#   --sdk      SDK id under build/agent-sdk/agents/ (default: codex)
#
# Env knobs (all optional):
#   AGENT_SDK_URL_TEMPLATE  Full download-URL template. Default:
#     https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-{sdk}-{sdkVersion}/{sdk}-{sdkVersion}-{sdkTarget}.tgz
#     Override to move distribution to another self-hosted endpoint
#     (object storage, own domain) — the only change a migration needs.
#   AGENT_SDK_RESULTS_FILE  Where the results JSON lands
#     (default: .build/agent-sdk/results.json). package.sh exports the same
#     path when invoking gulp so packageTask stamps product.agentSdks.
#
# Outputs:
#   .build/agent-sdk/tarballs/<sdk>-<version>-<target>.tgz
#   .build/agent-sdk/results.json    { "<sdk>": { version, urlTemplate, sha256 } }
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SDK="codex"
TARGET=""
while [ $# -gt 0 ]; do
	case "$1" in
		--target=*) TARGET="${1#*=}"; shift ;;
		--sdk=*) SDK="${1#*=}"; shift ;;
		-h|--help) sed -n '2,34p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH (use node@24: export PATH=/opt/homebrew/opt/node@24/bin:\$PATH)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "node >= 22 required (type-stripping for build/agent-sdk/*.ts), got $(node --version)"

# Default target from the host.
if [ -z "$TARGET" ]; then
	case "$(uname -s)-$(uname -m)" in
		Darwin-arm64) TARGET="darwin-arm64" ;;
		Darwin-x86_64) TARGET="darwin-x64" ;;
		Linux-x86_64) TARGET="linux-x64" ;;
		Linux-aarch64) TARGET="linux-arm64" ;;
		*) fail "cannot derive sdkTarget from host $(uname -s)-$(uname -m); pass --target=" ;;
	esac
fi

# sdkTarget → (vscode-platform, arch) for produce.ts.
case "$TARGET" in
	darwin-arm64) VSCODE_PLATFORM="darwin"; ARCH="arm64" ;;
	darwin-x64) VSCODE_PLATFORM="darwin"; ARCH="x64" ;;
	linux-x64) VSCODE_PLATFORM="linux"; ARCH="x64" ;;
	linux-arm64) VSCODE_PLATFORM="linux"; ARCH="arm64" ;;
	win32-x64) VSCODE_PLATFORM="win32"; ARCH="x64" ;;
	win32-arm64) VSCODE_PLATFORM="win32"; ARCH="arm64" ;;
	*) fail "unknown sdkTarget: $TARGET" ;;
esac

RESULTS_FILE="${AGENT_SDK_RESULTS_FILE:-$REPO_ROOT/.build/agent-sdk/results.json}"
TARBALLS_DIR="$REPO_ROOT/.build/agent-sdk/tarballs"

SDK_VERSION="$(node -p "const d=JSON.parse(require('fs').readFileSync('build/agent-sdk/agents/$SDK/package.json','utf8')).dependencies; d[Object.keys(d)[0]]")"

# The results file accumulates per-target entries across invocations
# (produce.ts merges). A file stamped for a DIFFERENT SDK version is
# incoherent with what we are about to build — drop it before producing so
# the merge never mixes versions (mergeAgentSdkResults would fail loud).
if [ -f "$RESULTS_FILE" ]; then
	if [ "$(node -p "const r=JSON.parse(require('fs').readFileSync('$RESULTS_FILE','utf8')); r['$SDK'] ? r['$SDK'].version : ''")" != "$SDK_VERSION" ]; then
		echo "    removing stale results file $RESULTS_FILE (recorded $SDK version differs from the pinned $SDK_VERSION)"
		rm -f "$RESULTS_FILE"
	fi
fi

# D09 ruling 1: default distribution endpoint = this repo's GitHub Releases.
# Assets are flat file names under the tag `agent-sdk-<sdk>-<version>`, so a
# full URL template (not a CDN base) is required — buildCdnUrlTemplate honors
# AGENT_SDK_URL_TEMPLATE and keeps {sdkTarget} intact for the runtime.
# NOTE: assigned via an intermediate variable — an inline ${VAR:-...{sdk}...}
# default would let bash's brace parsing mangle the template.
DEFAULT_URL_TEMPLATE='https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-{sdk}-{sdkVersion}/{sdk}-{sdkVersion}-{sdkTarget}.tgz'
export AGENT_SDK_URL_TEMPLATE="${AGENT_SDK_URL_TEMPLATE:-$DEFAULT_URL_TEMPLATE}"
export AGENT_SDK_RESULTS_FILE="$RESULTS_FILE"
# Build + write results, but do NOT upload here: publishing is a separate,
# explicit step (scripts/publish-sdk-release.sh) so a local packaging run
# never mutates the public distribution endpoint.
export AGENT_SDK_UPLOAD=false
export AGENT_SDK_WRITE_RESULTS=true

echo "==> Bundling agent SDK '$SDK' for $TARGET"
echo "    url template: $AGENT_SDK_URL_TEMPLATE"
echo "    results file: $RESULTS_FILE"

node build/agent-sdk/produce.ts --vscode-platform="$VSCODE_PLATFORM" --arch="$ARCH" --sdks="$SDK"

TGZ="$TARBALLS_DIR/$SDK-$SDK_VERSION-$TARGET.tgz"
[ -f "$TGZ" ] || fail "expected tarball missing: $TGZ"

# --- Apache-2.0 redistribution obligations (D17 section 4 item 4, D10 section 2) ----------
# The @openai/codex npm packages do NOT ship a LICENSE file (verified
# 2026-09-20 against 0.153.0). Apache-2.0 section 4 requires the license text (and
# NOTICE, if any) to accompany redistribution, so we inject the vendored
# copies and re-pack with the same node-tar portable settings package.ts
# uses. If a future SDK version starts shipping its own license, that also
# satisfies the obligation — skip the injection then.
#
# L4: the guard is anchored at the SDK package's own directory
# (node_modules/<dep>/(LICENSE|NOTICE)), not the whole tree — a transitive
# dependency's license file must not satisfy the SDK's own obligation.
SDK_DEP_NAME="$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('build/agent-sdk/agents/$SDK/package.json','utf8')).dependencies)[0]")"
SDK_LICENSE_RE="(^|/)node_modules/$(printf '%s' "$SDK_DEP_NAME" | sed 's/[.[\*^$]/\\&/g')/[^/]*license|(^|/)node_modules/$(printf '%s' "$SDK_DEP_NAME" | sed 's/[.[\*^$]/\\&/g')/[^/]*notice"
if tar -tzf "$TGZ" | grep -qiE "$SDK_LICENSE_RE"; then
	echo "    tarball already carries the SDK's own LICENSE/NOTICE — injection not needed"
else
	LICENSE_DIR="$REPO_ROOT/build/agent-sdk/licenses/$SDK"
	[ -f "$LICENSE_DIR/LICENSE" ] || fail "$SDK tarball ships no license and no vendored copy exists at $LICENSE_DIR — Apache-2.0 obligations unmet"
	echo "    injecting LICENSE + NOTICE into $(basename "$TGZ") (Apache-2.0 section 4)"
	node --input-type=module - "$TGZ" "$LICENSE_DIR" "$REPO_ROOT" "$SDK" <<'NODE_EOF'
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { buildTarball } from './build/agent-sdk/package.ts';

const [tgz, licenseDir, repoRoot, sdk] = process.argv.slice(2);
const pkgName = JSON.parse(fs.readFileSync(path.join(repoRoot, 'build/agent-sdk/agents', sdk, 'package.json'), 'utf8'));
const depName = Object.keys(pkgName.dependencies)[0]; // e.g. @openai/codex

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-license-inject-'));
try {
	await tar.x({ file: tgz, cwd: tmp });
	const destDir = path.join(tmp, 'node_modules', ...depName.split('/'));
	if (!fs.existsSync(destDir)) {
		throw new Error(`expected package dir missing in tarball: ${destDir}`);
	}
	for (const f of ['LICENSE', 'NOTICE']) {
		const src = path.join(licenseDir, f);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(destDir, f));
		}
	}
	await buildTarball(tmp, tgz);
	console.log(`    repacked ${tgz}`);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
NODE_EOF
	# Re-check: the repacked tarball MUST carry the license now.
	tar -tzf "$TGZ" | grep -qiE "$SDK_LICENSE_RE" || fail "license injection did not take effect in $TGZ"
fi

# HIGH-1 integrity chain: results.json must carry the sha256 of the FINAL
# tarball bytes — the license-injection repack above changes them, so the
# hash produce.ts wrote (computed pre-injection) would be stale for THIS
# target. Recompute and restamp per target, merging with whatever other
# targets earlier invocations recorded (sequential --target=... runs must
# accumulate, not overwrite each other — a macOS Universal product.json
# reads both). The legacy scalar `sha256` key is dropped so a stamped
# product.json never carries a hash that is valid for only one target.
# The runtime downloader verifies the download against this hash before
# extracting, and publish-sdk-release.sh publishes exactly these bytes — so
# product.json, the release asset digest, and the runtime check all agree.
FINAL_SHA="$(shasum -a 256 "$TGZ" | awk '{print $1}')"
node - "$RESULTS_FILE" "$SDK" "$TARGET" "$FINAL_SHA" <<'NODE_EOF'
const fs = require('fs');
const [resultsFile, sdk, target, sha] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
if (!results[sdk]) {
	console.error(`ERROR: results file ${resultsFile} has no entry for sdk '${sdk}'`);
	process.exit(1);
}
const entry = results[sdk];
delete entry.sha256; // legacy scalar: valid for at most one target — never stamp it (H1)
entry.sha256ByTarget = { ...(entry.sha256ByTarget ?? {}), [target]: sha };
fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2) + '\n');
console.log(`    results.json sha256ByTarget['${target}'] stamped: ${sha}`);
NODE_EOF

# M5: the tarballs dir is a content-addressed staging area, not an archive —
# a stale .tgz from an older version would be published by
# publish-sdk-release.sh's whole-dir glob (creating/updating its release tag)
# and listed in package.sh's SHA256SUMS. Prune anything the current results
# file does not reference so the dir always equals "what product.json
# points at". Tarball names are `<sdk>-<version>-<sdkTarget>.tgz` (the
# convention package.ts/publish-sdk-release.sh share).
node - "$RESULTS_FILE" "$TARBALLS_DIR" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const [resultsFile, tarballsDir] = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const keep = new Set();
for (const [sdk, entry] of Object.entries(results)) {
	for (const target of Object.keys(entry.sha256ByTarget ?? {})) {
		keep.add(`${sdk}-${entry.version}-${target}.tgz`);
	}
	// A results entry whose hashes were never restamped (no sha256ByTarget
	// yet) still corresponds to a just-built tarball; keep the version's
	// tarballs rather than pruning what produce.ts just wrote.
	if (!entry.sha256ByTarget) {
		for (const f of fs.readdirSync(tarballsDir)) {
			if (f.startsWith(`${sdk}-${entry.version}-`) && f.endsWith('.tgz')) {
				keep.add(f);
			}
		}
	}
}
for (const f of fs.readdirSync(tarballsDir)) {
	if (f.endsWith('.tgz') && !keep.has(f)) {
		fs.rmSync(path.join(tarballsDir, f));
		console.log(`    pruned stale tarball: ${f}`);
	}
}
NODE_EOF

echo
echo "==> SDK bundle ready:"
echo "    tarball: $TGZ"
echo "    results: $RESULTS_FILE"
cat "$RESULTS_FILE"
echo
echo "NOTE: the results JSON points at $AGENT_SDK_URL_TEMPLATE"
echo "      Publish the tarball there (bash scripts/publish-sdk-release.sh) before"
echo "      or after packaging — the packaged product.json records the URL either way."
