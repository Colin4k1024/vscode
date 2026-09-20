#!/usr/bin/env bash
# Pre-release gate chain (D09 #11 AC14; D17 section 4 item 8 — verify-beta-gates.sh
# rewritten; the original script's checks do not apply to the fork route).
#
# Gates (ALL hard-fail; order = cheap/static first):
#   1. product.json integrity: pristine vs HEAD, OR a correctly applied mixin
#      (apply-mixin --check) — the two states the build can legitimately be in.
#   2. Copilot hard block (D10 section 5): no copilot extension dirs / restricted
#      packages in the repo tree and (with --app) in the packaged product;
#      product.json must not reference defaultChatAgent / vscode-cdn.net.
#   3. clientInfo.name != vscode_agent_host (D10 section 3): we must not
#      misattribute traffic to Microsoft's registered OpenAI client name.
#   4. Gallery must not point at the MS Marketplace (D10): the merged
#      product.json must not reference marketplace.visualstudio.com /
#      *.vsassets.io / vscode-cdn.net.
#   5. SBOM generator runs (AC13).
#   6. R12 guard: Codex agent host defaults stay on.
#   7. Network egress audit (D08).
#   8. Branding residue scan (D06) — only with --app.
#
# Usage:
#   bash scripts/verify-beta-gates.sh [--app <packaged-app-or-dir>] [--skip-sbom]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_DIR=""
SKIP_SBOM=0
while [ $# -gt 0 ]; do
	case "$1" in
		--app) APP_DIR="${2:?--app needs a path}"; shift 2 ;;
		--skip-sbom) SKIP_SBOM=1; shift ;;
		-h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
	esac
done

fail() { echo "GATE FAILED: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH"

echo "==> [1/8] product.json integrity"
if [ -z "$(git status --porcelain -- product.json)" ]; then
	bash scripts/check-product-json-pristine.sh
else
	bash scripts/apply-mixin.sh --check >/dev/null || fail "product.json is modified but is NOT the applied mixin (git status shows local edits that are not the overlay merge)"
	echo "    product.json: applied mixin verified (apply-mixin --check)"
fi

echo "==> [2/8] Copilot hard block (D10 section 5)"
# 2a. The mixin must exclude Copilot from packaging (the packaged app is the
#     redistributable; the repo legitimately keeps extensions/copilot, D08 (a)).
node - <<'NODE_EOF'
const fs = require('fs');
const overlay = JSON.parse(fs.readFileSync('product/product.json', 'utf8'));
if (overlay.excludeCopilotFromPackaging !== true) {
	console.error('GATE FAILED: product/product.json must set "excludeCopilotFromPackaging": true (D10 section 5 redistribution hard block).');
	process.exit(1);
}
console.log('    mixin sets excludeCopilotFromPackaging: true — OK');
NODE_EOF
# 2b. With --app, scan the actual packaged artifact (node_modules dirs AND
#     the node_modules.asar — see check-no-copilot-artifacts.sh).
if [ -n "$APP_DIR" ]; then
	bash scripts/check-no-copilot-artifacts.sh "$APP_DIR"

	# 2c. The agent host bundle must not reach @vscode/copilot-api through a
	#     STATIC import (M2). The package is `external` in the esbuild bundle
	#     (build/next/bundle.ts), so a static value import would be emitted
	#     verbatim into agentHostMain.js — and with the package stripped from
	#     the packaged app (D10 section 5) it would crash the agent host at
	#     startup AND re-establish the redistribution path the D10 block
	#     exists to sever. The sanctioned dynamic import() (loadCopilotApi in
	#     copilotApiService.ts) fails per-call with a clear D10 error and is
	#     NOT flagged here. Pass/fail gate; platform-neutral path resolution
	#     (darwin: Contents/Resources/app/..., linux/win: resources/app/...).
	#
	#     Replaces the D09 probe for `copilot_internal/v2/token`, which occurs
	#     nowhere in the agent-host graph (nothing is inlined under
	#     packages:'external') and could never fire — false assurance.
	AGENT_HOST_MAIN="$(find "$APP_DIR" -type f -name 'agentHostMain.js' -path '*vs/platform/agentHost/node*' 2>/dev/null | head -1 || true)"
	if [ -z "$AGENT_HOST_MAIN" ]; then
		fail "gate 2c: agentHostMain.js not found under $APP_DIR — cannot verify the bundle has no static @vscode/copilot-api import"
	fi
	if grep -Eq "(from|import|export)[[:space:]]*[\"']@vscode/copilot-api[\"']|require\([[:space:]]*[\"']@vscode/copilot-api[\"']" "$AGENT_HOST_MAIN"; then
		echo "GATE FAILED: $AGENT_HOST_MAIN statically imports @vscode/copilot-api (D10 section 5: the package is not redistributable; a static import also crashes the agent host at startup in the branded build). Use the lazy loadCopilotApi() path instead." >&2
		exit 1
	fi
	echo "    agentHostMain.js: no static @vscode/copilot-api import — OK"
else
	echo "    packaged-artifact scan skipped (no --app; run against the packaged product before publishing)"
fi

echo "==> [3/8] clientInfo.name is not Microsoft's registered name (D10 section 3)"
node - <<'NODE_EOF'
const fs = require('fs');
const src = fs.readFileSync('src/vs/platform/agentHost/node/codex/codexAgent.ts', 'utf8');
const m = /const CLIENT_INFO = \{[^}]*?name:\s*'([^']+)'/s.exec(src);
if (!m) {
	console.error('GATE FAILED: could not locate CLIENT_INFO.name in codexAgent.ts — the gate must not silently pass.');
	process.exit(1);
}
if (m[1] === 'vscode_agent_host') {
	console.error("GATE FAILED: CLIENT_INFO.name is 'vscode_agent_host' — Microsoft's registered OpenAI client name. Reusing it misattributes our traffic (D10 section 3).");
	process.exit(1);
}
console.log(`    clientInfo.name = '${m[1]}' — OK`);
NODE_EOF

echo "==> [4/8] extension gallery is not the MS Marketplace (D10)"
node - <<'NODE_EOF'
const fs = require('fs');
const base = JSON.parse(fs.readFileSync('product.json', 'utf8'));
// Merge the overlay the same way apply-mixin does (overlay wins; null deletes).
let overlay = {};
try { overlay = JSON.parse(fs.readFileSync('product/product.json', 'utf8')); } catch { /* no overlay */ }
const merged = { ...base, ...overlay };
for (const [k, v] of Object.entries(overlay)) { if (v === null) { delete merged[k]; } }
const text = JSON.stringify(merged);
const msGallery = /marketplace\.visualstudio\.com|gallery(?:cdn)?\.vsassets\.io|gallerycdn\.vscassets\.io/;
if (msGallery.test(text)) {
	console.error('GATE FAILED: effective product.json points at the Microsoft Marketplace — the fork must not redistribute against it (D10). Set extensionsGallery to Open VSX or remove it.');
	process.exit(1);
}
const gallery = merged.extensionsGallery;
console.log(`    extensionsGallery: ${gallery ? JSON.stringify(gallery.serviceUrl ?? gallery) : '(absent — extension gallery disabled)'}`);
NODE_EOF

echo "==> [5/8] SBOM generator runs (AC13)"
if [ "$SKIP_SBOM" -eq 1 ]; then
	echo "    skipped (--skip-sbom)"
else
	bash scripts/generate-sbom.sh >/dev/null || fail "generate-sbom.sh failed"
	echo "    SBOM generation: OK (.build/sbom/sbom.cdx.json)"
fi

echo "==> [6/8] R12 guard (agent host defaults)"
bash scripts/check-r12-guard.sh

echo "==> [7/8] network egress audit (D08)"
bash scripts/audit-network-egress.sh

echo "==> [8/8] branding residue (D06)"
if [ -n "$APP_DIR" ]; then
	bash scripts/check-branding-residue.sh "$APP_DIR"
else
	echo "    skipped (no --app; run against the packaged product before publishing)"
fi

echo
echo "ALL BETA GATES PASSED"
