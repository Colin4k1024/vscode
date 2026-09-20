#!/usr/bin/env bash
# D15 / Issue #17 — extension gallery & sessions-window allow-list guard.
#
# Merges product/product.json (the ColinCode mixin overlay) onto the upstream
# product.json IN MEMORY (same semantics as scripts/apply-mixin.sh and
# scripts/audit-network-egress.sh; the working tree is not mutated) and asserts
# the shipped configuration:
#
#   1. extensionsGallery is configured (G9 fixed) and EVERY URL in it points at
#      open-vsx.org — the Microsoft Marketplace ToS restricts its gallery to
#      official Visual Studio products (LICENSE-CLEARANCE.md section 10), so any other
#      host fails the gate. This is the executable form of checklist E1.
#   2. The merged configuration references no Microsoft Marketplace host at all
#      (marketplace.visualstudio.com / *.vsassets.io / vscodegallery.net ...).
#   3. sessionsWindowAllowedExtensions is pinned to [] — the D15 decision is an
#      EMPTY allow-list (D15-GALLERY.md section 3): the agent-host kernel is in-tree,
#      declarative-only extensions (themes/languages/grammars/keybindings)
#      already run in the Agents window via canExecuteOnSessionsWindow, and no
#      code-bearing third-party extension is vetted for it yet. The overlay
#      must declare the key explicitly so an upstream change to the root
#      product.json cannot silently widen it.
#
# Usage: bash scripts/check-extension-gallery.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH (use node@24)"

node <<'NODE_EOF'
const fs = require('fs');

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const base = readJson('product.json');
const overlay = readJson('product/product.json');

// Mirror scripts/apply-mixin.sh merge semantics: overlay keys win; an overlay
// value of `null` deletes the key; builtInExtensions accepts {include, exclude}.
let merged = { ...base, ...overlay };
for (const [key, value] of Object.entries(overlay)) {
	if (value === null) {
		delete merged[key];
	}
}
if (overlay.builtInExtensions !== undefined) {
	const include = overlay.builtInExtensions.include ?? [];
	const exclude = overlay.builtInExtensions.exclude ?? [];
	const kept = (base.builtInExtensions ?? []).filter(e => !include.some(i => i.name === e.name) && !exclude.includes(e.name));
	merged = { ...merged, builtInExtensions: [...kept, ...include] };
}

let failed = false;
const err = msg => { console.error(`ERROR: ${msg}`); failed = true; };

// --- 1. extensionsGallery: configured, and every URL host is open-vsx.org ----
const ALLOWED_GALLERY_HOSTS = new Set(['open-vsx.org']);
const gallery = merged.extensionsGallery;
if (!gallery || typeof gallery !== 'object') {
	err('merged product.json has no extensionsGallery — the D15 decision is Open VSX (G9 must stay fixed)');
} else {
	if (!gallery.serviceUrl) {
		err('merged extensionsGallery.serviceUrl is missing — the gallery would be disabled at runtime');
	}
	for (const [key, value] of Object.entries(gallery)) {
		if (typeof value !== 'string' || !value) {
			continue;
		}
		// resourceUrlTemplate carries {publisher} placeholders, so parse the host
		// manually instead of via new URL() (which rejects `{`).
		const hostMatch = /^https?:\/\/([^/?#{]+)/.exec(value);
		if (!hostMatch) {
			err(`extensionsGallery.${key} is not an absolute http(s) URL: ${value}`);
			continue;
		}
		const host = hostMatch[1];
		if (!ALLOWED_GALLERY_HOSTS.has(host)) {
			err(`extensionsGallery.${key} points at non-allow-listed host '${host}' (allowed: ${[...ALLOWED_GALLERY_HOSTS].join(', ')}) — the Microsoft Marketplace ToS forbids third-party products from using it (LICENSE-CLEARANCE.md section 10)`);
		}
	}
}

// --- 2. No Microsoft Marketplace host anywhere in the merged configuration ---
const MS_MARKETPLACE_HOSTS = [
	'marketplace.visualstudio.com',
	'vsassets.io',          // covers gallery.vsassets.io / gallerycdn.vsassets.io
	'vscodegallery.net',
	'vsmarketplacebadge',   // badge/shield services
	'visualstudio.com/gallery',
];
const mergedText = JSON.stringify(merged);
for (const host of MS_MARKETPLACE_HOSTS) {
	if (mergedText.includes(host)) {
		err(`merged product.json references Microsoft Marketplace host '${host}'`);
	}
}

// --- 3. sessionsWindowAllowedExtensions pinned to [] -------------------------
if (!('sessionsWindowAllowedExtensions' in overlay)) {
	err('product/product.json must declare sessionsWindowAllowedExtensions explicitly (the D15 empty allow-list decision), so an upstream change to the root product.json cannot silently widen it');
}
const allowList = merged.sessionsWindowAllowedExtensions;
if (!Array.isArray(allowList) || allowList.length !== 0) {
	err(`merged sessionsWindowAllowedExtensions must be [] (D15 decision: no code-bearing third-party extension is vetted for the Agents window yet); got ${JSON.stringify(allowList)}`);
}

if (failed) {
	process.exit(1);
}
console.log('    extension gallery: Open VSX only, no MS Marketplace host, sessionsWindowAllowedExtensions pinned to []: OK');
NODE_EOF

echo "==> Extension gallery guard passed"
