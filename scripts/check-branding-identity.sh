#!/usr/bin/env bash
# AC2/AC3 (Issue #8): static assertions that the ColinCode identity fields
# (a) are independent — dataFolderName/sharedDataFolderName do not collide with
#     any VS Code variant's data directories, so dev profiles and user data
#     stay separate (~/.colincode-dev vs ~/.vscode-oss-dev);
# (b) coexist with official VS Code / Code-OSS installs — bundle id, URL
#     protocol, registry/AppUserModelId/mutex, desktop-entry and icon names,
#     and all Inno AppId GUIDs differ from every upstream variant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OVERLAY="$REPO_ROOT/product/product.json"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH"
[ -f "$OVERLAY" ] || fail "overlay not found: $OVERLAY"

node - "$OVERLAY" <<'NODE_EOF'
const fs = require('fs');
const overlay = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Known identity values of upstream variants (microsoft/vscode product.json,
// Code-OSS product.json, and the Insiders/Exploration channels).
const upstream = {
	dataFolderName: ['.vscode', '.vscode-oss', '.vscode-insiders', '.vscode-exploration'],
	sharedDataFolderName: ['.vscode', '.vscode-oss', '.vscode-insiders', '.vscode-exploration', 'vscode', 'vscode-oss'],
	darwinBundleIdentifier: ['com.visualstudio.code', 'com.visualstudio.code.oss', 'com.visualstudio.code.insiders', 'com.visualstudio.code.exploration'],
	urlProtocol: ['vscode', 'code-oss', 'vscode-insiders', 'vscode-exploration'],
	win32RegValueName: ['VisualStudioCode', 'CodeOSS', 'VisualStudioCodeInsiders'],
	win32AppUserModelId: ['Microsoft.VisualStudioCode', 'Microsoft.CodeOSS', 'Microsoft.VisualStudioCodeInsiders'],
	win32MutexName: ['vscode', 'vscodeoss', 'vscode-insiders'],
	win32TunnelServiceMutex: ['vscode-tunnelservice', 'vscodeoss-tunnelservice'],
	win32TunnelMutex: ['vscode-tunnel', 'vscodeoss-tunnel'],
	linuxDesktopName: ['code', 'code-oss', 'com.visualstudio.CodeOSS', 'code-insiders'],
	linuxIconName: ['code', 'code-oss', 'com.visualstudio.code', 'vscode'],
	applicationName: ['code', 'code-oss', 'code-insiders', 'code-exploration'],
	serverApplicationName: ['code-server', 'code-server-oss', 'code-server-insiders'],
	serverDataFolderName: ['.vscode', '.vscode-oss', '.vscode-server', '.vscode-server-oss', '.vscode-insiders', '.vscode-server-insiders'],
	tunnelApplicationName: ['code-tunnel', 'code-tunnel-oss', 'code-tunnel-insiders'],
};

// All AppId/UUID fields must exist, be unique within the overlay, and differ
// from every known upstream GUID/UUID.
const upstreamGuids = new Set([
	// Code-OSS product.json (this repo's upstream)
	'D77B7E06-80BA-4137-BCF4-654B95CCEBC5', 'D1ACE434-89C5-48D1-88D3-E2991DF85475',
	'CC6B787D-37A0-49E8-AE24-8559A032BE0C', '3AEBF0C8-F733-4AD4-BADE-FDB816D53D7B',
	'47827DD9-4734-49A0-AF80-7E19B11495CC', 'CF808BE7-53F3-46C6-A7E2-7EDB98A5E959',
	// VS Code stable
	'C26E74D1-022E-4238-8B9D-5E0243E702D5', '1287CAD5-7C8D-410D-88B9-0D84D5595478',
	'F3A4F5BF-CD74-4550-9E62-902047A02802', 'EA457B21-F73E-494C-ACAB-524FDE069978',
	'1287CAD5-7C8D-410D-88B9-0D84D5595478',
	// darwin profile UUIDs of stable
	'79958170-625B-4DAF-A6EA-3C6C6B84A417', '6F6A5D3F-94B3-4F7B-A65A-6B57E8C7E72D',
]);
const guidFields = [
	'win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId',
	'darwinProfileUUID', 'darwinProfilePayloadUUID',
];

let failures = 0;
const err = m => { console.error(`ERROR: ${m}`); failures++; };

for (const [field, banned] of Object.entries(upstream)) {
	const v = overlay[field];
	if (v === undefined) { err(`overlay is missing coexistence-critical field "${field}"`); continue; }
	if (banned.includes(v)) { err(`"${field}" = "${v}" collides with an upstream VS Code variant`); }
}

const seen = new Map();
for (const f of guidFields) {
	let v = overlay[f];
	if (v === undefined) { err(`overlay is missing "${f}"`); continue; }
	v = v.replace(/^\{\{?/, '').replace(/\}\}?$/, '').toUpperCase();
	if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(v)) {
		err(`"${f}" is not a valid GUID/UUID: ${overlay[f]}`); continue;
	}
	if (upstreamGuids.has(v)) { err(`"${f}" reuses an upstream GUID/UUID ${v} — generate a fresh one`); }
	if (seen.has(v)) { err(`"${f}" duplicates "${seen.get(v)}" (${v})`); }
	seen.set(v, f);
}

if (failures > 0) { process.exit(1); }
console.log('branding identity coexistence: PASS (data folders independent; no upstream field/GUID collisions)');
NODE_EOF
