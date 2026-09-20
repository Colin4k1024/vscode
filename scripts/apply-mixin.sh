#!/usr/bin/env bash
# Apply the ColinCode product mixin to the in-tree VS Code fork.
#
# Ported from grok-code-product/scripts/apply-patches.sh (mixin half only;
# D17 §4: 改造后复用). Differences from the source script:
#   * no patch half (in-tree fork route, 0 patches)
#   * product.json overlay is DEEP-MERGED onto the upstream product.json
#     (upstream file stays 0-diff in git; the merged result is a working-tree
#     build artifact, same semantics as build/azure-pipelines/distro/mixin-quality.ts)
#   * EVERY failure is a hard failure (the source script silently skipped
#     `git apply` failures and an undeliverable default-settings copy —
#     that defect is deliberately not inherited)
#
# Usage:
#   bash scripts/apply-mixin.sh           apply the mixin to the working tree
#   bash scripts/apply-mixin.sh --check   verify the mixin is fully applied (CI gate)
#
# Revert: git checkout -- product.json resources/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCT_DIR="$REPO_ROOT/product"
OVERLAY="$PRODUCT_DIR/product.json"
TARGET="$REPO_ROOT/product.json"
if [ $# -gt 1 ]; then
	echo "ERROR: too many arguments (usage: $0 [--check])" >&2
	exit 2
fi
case "${1:-apply}" in
	apply) MODE="apply" ;;
	--check) MODE="--check" ;;
	*) echo "ERROR: unknown argument: ${1:-} (usage: $0 [--check])" >&2; exit 2 ;;
esac

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$OVERLAY" ] || fail "overlay not found: $OVERLAY"
[ -f "$TARGET" ] || fail "upstream product.json not found: $TARGET"
command -v node >/dev/null 2>&1 || fail "node not found on PATH (use node@24: export PATH=/opt/homebrew/opt/node@24/bin:\$PATH)"

# --- 1. product.json overlay merge -------------------------------------------
# Semantics aligned with build/azure-pipelines/distro/mixin-quality.ts:
# overlay keys win; `builtInExtensions` accepts {include, exclude} and is
# rebased onto the upstream array; a raw array there is a hard error.
node - "$TARGET" "$OVERLAY" "$MODE" <<'NODE_EOF'
const fs = require('fs');
const [targetPath, overlayPath, mode] = process.argv.slice(2);

function readJson(p) {
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8'));
	} catch (e) {
		console.error(`ERROR: invalid JSON in ${p}: ${e.message}`);
		process.exit(1);
	}
}

const base = readJson(targetPath);
const overlay = readJson(overlayPath);

if (overlay.quality === 'stable') {
	console.error('ERROR: R12 guard — overlay must not set quality: "stable" (it would default-disable the Codex agent host).');
	process.exit(1);
}

let merged = { ...base, ...overlay };
if (overlay.builtInExtensions !== undefined) {
	if (Array.isArray(overlay.builtInExtensions)) {
		console.error('ERROR: overlay builtInExtensions must be { include, exclude }, not an array (mixin-quality semantics).');
		process.exit(1);
	}
	const include = overlay.builtInExtensions.include ?? [];
	const exclude = overlay.builtInExtensions.exclude ?? [];
	const kept = (base.builtInExtensions ?? []).filter(e => !include.some(i => i.name === e.name) && !exclude.includes(e.name));
	merged = { ...merged, builtInExtensions: [...kept, ...include] };
}

const mergedText = JSON.stringify(merged, null, '\t') + '\n';

if (mode === '--check') {
	const current = fs.readFileSync(targetPath, 'utf8');
	// --check compares against merge(HEAD base, overlay); when the mixin is
	// already applied, merging again must be idempotent.
	if (current !== mergedText && JSON.stringify(readJson(targetPath)) !== JSON.stringify(merged)) {
		console.error('ERROR: product.json does not match the applied mixin. Run scripts/apply-mixin.sh.');
		process.exit(1);
	}
	console.log('    product.json mixin: OK');
} else {
	fs.writeFileSync(targetPath, mergedText, 'utf8');
	console.log('    product.json overridden (working tree; upstream file remains 0-diff in git)');
}
NODE_EOF

# --- 2. default-settings.json (R12 declarative layer) -------------------------
DEFAULT_SETTINGS="$PRODUCT_DIR/default-settings.json"
[ -f "$DEFAULT_SETTINGS" ] || fail "default-settings.json not found: $DEFAULT_SETTINGS"
node - "$DEFAULT_SETTINGS" <<'NODE_EOF'
const fs = require('fs');
const p = process.argv[2];
let s;
	try {
		s = JSON.parse(fs.readFileSync(p, 'utf8'));
	} catch (e) {
		console.error(`ERROR: invalid JSON in ${p}: ${e.message}`);
		process.exit(1);
	}
// R12: these two settings must default to true in the branded product and must
// not depend on product.quality derivation. VS Code has no product-level
// default-settings mechanism; the runtime realization is the in-code schema
// default (verified by scripts/check-r12-guard.sh). This file is the
// declarative record — the guard script fails if it drifts from the code.
for (const key of ['chat.agentHost.codexAgent.enabled', 'chat.editor.codex.preferAgentHost']) {
	if (s[key] !== true) {
		console.error(`ERROR: R12 guard — default-settings.json must set "${key}": true`);
		process.exit(1);
	}
}
console.log('    default-settings.json validated (R12 keys present and true)');
NODE_EOF

# --- 3. extensions.json (reserved for the D09 build pipeline) -----------------
EXTENSIONS_JSON="$PRODUCT_DIR/extensions.json"
[ -f "$EXTENSIONS_JSON" ] || fail "extensions.json not found: $EXTENSIONS_JSON"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$EXTENSIONS_JSON" \
	|| fail "invalid JSON in $EXTENSIONS_JSON"
echo "    extensions.json validated"

# --- 4. branding assets --------------------------------------------------------
copy_asset() {
	local src="$1" dst="$2"
	[ -f "$src" ] || fail "branding asset missing: $src (run scripts/generate-icons.sh first)"
	if [ "$MODE" = "--check" ]; then
		cmp -s "$src" "$dst" || fail "branding asset not applied: $dst"
		echo "    $dst: OK"
	else
		mkdir -p "$(dirname "$dst")"
		cp "$src" "$dst" || fail "failed to copy $src -> $dst"
		echo "    $dst"
	fi
}

echo "==> Applying branding assets"
copy_asset "$PRODUCT_DIR/branding/darwin/colincode.icns"        "$REPO_ROOT/resources/darwin/code.icns"
copy_asset "$PRODUCT_DIR/branding/win32/colincode.ico"          "$REPO_ROOT/resources/win32/code.ico"
copy_asset "$PRODUCT_DIR/branding/win32/colincode_70x70.png"    "$REPO_ROOT/resources/win32/code_70x70.png"
copy_asset "$PRODUCT_DIR/branding/win32/colincode_150x150.png"  "$REPO_ROOT/resources/win32/code_150x150.png"
copy_asset "$PRODUCT_DIR/branding/linux/colincode.png"          "$REPO_ROOT/resources/linux/code.png"
copy_asset "$PRODUCT_DIR/branding/linux/colincode.appdata.xml"  "$REPO_ROOT/resources/linux/code.appdata.xml"

# D06 round-1 (M1): the remaining upstream-brand slots in packaged builds.
# win32 Start-menu tile manifest (ShortDisplayName etc.)
copy_asset "$PRODUCT_DIR/branding/win32/VisualElementsManifest.xml" "$REPO_ROOT/resources/win32/VisualElementsManifest.xml"
# win32 Inno Setup wizard images at every DPI scale
for scale in 100 125 150 175 200 225 250; do
	copy_asset "$PRODUCT_DIR/branding/win32/inno-big-$scale.bmp"   "$REPO_ROOT/resources/win32/inno-big-$scale.bmp"
	copy_asset "$PRODUCT_DIR/branding/win32/inno-small-$scale.bmp" "$REPO_ROOT/resources/win32/inno-small-$scale.bmp"
done
# server / web client icons
copy_asset "$PRODUCT_DIR/branding/server/code-192.png" "$REPO_ROOT/resources/server/code-192.png"
copy_asset "$PRODUCT_DIR/branding/server/code-512.png" "$REPO_ROOT/resources/server/code-512.png"
copy_asset "$PRODUCT_DIR/branding/server/favicon.ico"  "$REPO_ROOT/resources/server/favicon.ico"
# darwin file-type document icons (27 upstream icns embed the VS Code logo);
# one branded document icns covers every file-type slot. code.icns is handled
# above and stays the app icon.
for dst in "$REPO_ROOT/resources/darwin/"*.icns; do
	name="$(basename "$dst")"
	[ "$name" = "code.icns" ] && continue
	copy_asset "$PRODUCT_DIR/branding/darwin/colincode-file.icns" "$dst"
done
# branding/app/ holds the generic PNG size set for packaging consumers
# (DMG, web, D09 pipeline). resources/app/ is a build-created directory and is
# deliberately NOT populated in the repo working tree.

echo "==> Done. (revert with: git checkout -- product.json resources/)"
