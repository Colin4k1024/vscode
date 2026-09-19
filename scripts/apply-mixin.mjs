#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// codex-desktop D06: product-identity mixin applier.
//
// Fork of the "product mixin" half of grok-code-product's apply-patches.sh
// (D17 ROUTE-DECISION.md §4 ruling #2): every failure is a HARD failure -
// the original script's `|| echo WARNING` silent-skip is deliberately removed
// because it produced unreproducible builds.
//
// The upstream root product.json is NEVER modified (acceptance 9:
// `git diff --stat product.json` stays 0). Instead:
//   - dev: the overlay is written to the gitignored product.overrides.json,
//     which upstream's src/bootstrap-meta.ts already loads when VSCODE_DEV=1
//     (shallow Object.assign - hence the "scalars only" rule below).
//   - packaging: `--out <path>` emits the full merged product.json for the
//     D09 pipeline to consume before gulp/vsce packaging targets.
//
// Usage:
//   node scripts/apply-mixin.mjs            validate + write dev override (product.overrides.json)
//   node scripts/apply-mixin.mjs --check    validate only, no writes (CI gate)
//   node scripts/apply-mixin.mjs --out F    validate + write full merged product.json to F
//   node scripts/apply-mixin.mjs --revert   delete product.overrides.json (back to Code-OSS identity)

import fs from 'fs';
import path from 'path';
import process from 'process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const baseProductPath = path.join(repoRoot, 'product.json');
const overlayPath = path.join(repoRoot, 'product', 'product.json');
const defaultSettingsPath = path.join(repoRoot, 'product', 'default-settings.json');
const devOverridesPath = path.join(repoRoot, 'product.overrides.json');
const brandingDir = path.join(repoRoot, 'product', 'branding');

const failures = [];
const notes = [];
function fail(message) { failures.push(message); }
function note(message) { notes.push(message); }

// --- identity fields the overlay must own (issue #8 scope) ------------------
const REQUIRED_FIELDS = [
	'nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'sharedDataFolderName',
	'win32MutexName', 'win32DirName', 'win32NameVersion', 'win32RegValueName',
	'win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId',
	'win32AppUserModelId', 'win32ShellNameShort', 'win32TunnelServiceMutex', 'win32TunnelMutex',
	'darwinBundleIdentifier', 'darwinProfileUUID', 'darwinProfilePayloadUUID',
	'linuxDesktopName', 'linuxIconName', 'urlProtocol',
	'serverApplicationName', 'serverDataFolderName', 'tunnelApplicationName',
	'licenseName', 'licenseUrl', 'licenseFileName', 'reportIssueUrl',
];

// Fields whose values must differ from both the official Microsoft VS Code
// product and this repo's Code-OSS base so installs can coexist (acceptance 3).
const COEXISTENCE_FIELDS = [
	'applicationName', 'dataFolderName', 'sharedDataFolderName', 'urlProtocol',
	'win32MutexName', 'win32RegValueName', 'win32AppUserModelId',
	'win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId',
	'win32TunnelServiceMutex', 'win32TunnelMutex',
	'darwinBundleIdentifier', 'linuxDesktopName',
	'serverApplicationName', 'serverDataFolderName', 'tunnelApplicationName',
];

// Trademark/compliance guard (LICENSE-CLEARANCE.md §1, §2; D10 constraints):
// the product name and install identity must not contain Microsoft's or
// OpenAI's marks. Checked on name-like fields only - URLs (e.g. licenseUrl
// pointing at the MIT source) are exempt.
const BANNED_TOKENS = [/visual\s+studio\s+code/i, /\bvscode\b/i, /code\s*-\s*oss/i, /\bcodex\b/i, /\bcode\b/i];
const NAME_FIELDS = [
	'nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'sharedDataFolderName',
	'win32MutexName', 'win32DirName', 'win32NameVersion', 'win32RegValueName',
	'win32AppUserModelId', 'win32ShellNameShort', 'win32TunnelServiceMutex', 'win32TunnelMutex',
	'darwinBundleIdentifier', 'linuxDesktopName', 'linuxIconName', 'urlProtocol',
	'serverApplicationName', 'serverDataFolderName', 'tunnelApplicationName', 'licenseName',
];

// Official Microsoft VS Code (stable) identity values that must never collide.
const OFFICIAL_IDENTITY = {
	applicationName: 'code',
	dataFolderName: '.vscode',
	urlProtocol: 'vscode',
	win32MutexName: 'vscode',
	win32RegValueName: 'Code',
	win32AppUserModelId: 'Microsoft.VisualStudioCode',
	darwinBundleIdentifier: 'com.microsoft.VSCode',
	linuxDesktopName: 'code',
	serverApplicationName: 'code-server',
	tunnelApplicationName: 'code-tunnel',
};

// R12 guard (issue #8 acceptance 5): both settings' registered default is
// `product.quality !== 'stable'`; a stable fork build would disable Codex.
const R12_KEYS = ['chat.agentHost.codexAgent.enabled', 'chat.editor.codex.preferAgentHost'];
const R12_REGISTRATION_SOURCES = [
	'src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts',
	'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts',
];

// --- load --------------------------------------------------------------------
function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const mode = process.argv[2] ?? '';
if (!['', '--check', '--out', '--revert'].includes(mode) || (mode === '--out' && !process.argv[3])) {
	console.error('usage: node scripts/apply-mixin.mjs [--check | --out <file> | --revert]');
	process.exit(2);
}

if (mode === '--revert') {
	if (fs.existsSync(devOverridesPath)) {
		fs.rmSync(devOverridesPath);
		console.log('[apply-mixin] removed product.overrides.json - dev runs fall back to Code-OSS identity');
	} else {
		console.log('[apply-mixin] product.overrides.json not present (already reverted)');
	}
	process.exit(0);
}

let base, overlay;
try {
	base = readJson(baseProductPath);
} catch (e) {
	fail(`cannot read base product.json: ${e.message}`);
}
try {
	overlay = readJson(overlayPath);
} catch (e) {
	fail(`cannot read overlay product/product.json: ${e.message}`);
}
const merged = base && overlay ? { ...base, ...overlay } : undefined;

if (base && overlay) {
	// 1. Required identity fields present and non-empty.
	for (const field of REQUIRED_FIELDS) {
		const value = overlay[field];
		if (typeof value !== 'string' || value.trim() === '') {
			fail(`overlay field "${field}" is missing or empty - the fork must own every identity field (issue #8 scope)`);
		}
	}

	// 2. Banned trademarks in name-like fields.
	for (const field of NAME_FIELDS) {
		const value = overlay[field];
		if (typeof value !== 'string') { continue; }
		for (const token of BANNED_TOKENS) {
			if (token.test(value)) {
				fail(`overlay field "${field}" value "${value}" contains banned token ${token} (D10: no VS Code / Visual Studio Code / Code / Codex in product identity)`);
			}
		}
	}

	// 3. Coexistence: no value shared with official VS Code or the Code-OSS base.
	for (const field of COEXISTENCE_FIELDS) {
		const value = overlay[field];
		if (typeof value !== 'string') { continue; }
		if (OFFICIAL_IDENTITY[field] && value.toLowerCase() === OFFICIAL_IDENTITY[field].toLowerCase()) {
			fail(`overlay field "${field}" value "${value}" collides with official VS Code identity - coexistence broken (acceptance 3)`);
		}
		if (base[field] !== undefined && value === base[field]) {
			fail(`overlay field "${field}" value "${value}" is identical to the Code-OSS base - coexistence broken (acceptance 3)`);
		}
	}

	// 4. Dev-override safety: the overlay must be scalars only (shallow assign).
	for (const [key, value] of Object.entries(overlay)) {
		if (key.startsWith('_comment')) { continue; }
		if (value !== null && typeof value === 'object') {
			fail(`overlay key "${key}" is an object/array - the dev path (bootstrap-meta.ts) shallow-assigns overrides, so nested values would silently replace whole upstream objects`);
		}
	}
	if (overlay['builtInExtensions'] !== undefined) {
		fail('overlay must not set builtInExtensions as a plain value - extend this script with the mixin-quality.ts include/exclude merge if fork extensions are ever needed');
	}

	// 5. R12 guard: quality must not be 'stable' unless defaults are explicitly
	//    overridden (there is no product-level defaults injection in 1.139, so
	//    the only safe state is: quality unset, or not 'stable').
	if (merged.quality === 'stable') {
		fail('merged product sets quality:"stable" - chat.agentHost.codexAgent.enabled and chat.editor.codex.preferAgentHost would default to FALSE and the Codex provider would not register (R12). Remove quality from the overlay or add an explicit defaults mechanism, then extend this check.');
	} else if (merged.quality !== undefined) {
		note(`merged product quality is "${merged.quality}" (not "stable") - R12 defaults stay enabled`);
	}

	let defaultSettings;
	try {
		defaultSettings = readJson(defaultSettingsPath);
		for (const key of R12_KEYS) {
			if (defaultSettings[key] !== true) {
				fail(`product/default-settings.json must record "${key}": true for the R12 guard to compare against`);
			}
		}
	} catch (e) {
		fail(`cannot validate product/default-settings.json: ${e.message}`);
	}

	// 6. Registration sources still derive both R12 defaults from quality.
	//    If upstream renames the expression, this guard (and the unit test)
	//    must be re-evaluated - that is intentional.
	for (const rel of R12_REGISTRATION_SOURCES) {
		try {
			const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
			const matches = source.match(/default:\s*product\.quality\s*!==\s*'stable'/g) ?? [];
			if (matches.length === 0) {
				fail(`${rel} no longer registers any \`default: product.quality !== 'stable'\` - re-audit the R12 keys (${R12_KEYS.join(', ')}) against the new default expression`);
			}
		} catch (e) {
			fail(`cannot read R12 registration source ${rel}: ${e.message}`);
		}
	}

	// 7. Branding assets exist.
	for (const asset of ['icon.svg', 'OpenAgents.icns', 'OpenAgents.ico', 'open-agents.png', 'icon_512x512.png']) {
		if (!fs.existsSync(path.join(brandingDir, asset))) {
			fail(`missing branding asset product/branding/${asset}`);
		}
	}

	if (merged?.version) {
		note('overlay sets product version explicitly - left as-is');
	}
}

// --- report / write ----------------------------------------------------------
if (failures.length > 0) {
	console.error('[apply-mixin] FAILED - product identity mixin rejected:');
	for (const f of failures) {
		console.error(`  - ${f}`);
	}
	process.exit(1);
}

for (const n of notes) {
	console.log(`[apply-mixin] note: ${n}`);
}

if (mode === '--check') {
	console.log('[apply-mixin] check passed - identity, coexistence, R12 and branding all valid');
	process.exit(0);
}

if (mode === '--out') {
	const outPath = path.resolve(process.argv[3]);
	const { _comment_fork, ...withoutComment } = merged;
	fs.writeFileSync(outPath, JSON.stringify(withoutComment, null, '\t'), 'utf8');
	console.log(`[apply-mixin] wrote merged product.json to ${outPath}`);
	process.exit(0);
}

// dev mode: strip _comment keys, write the gitignored override consumed by
// src/bootstrap-meta.ts (VSCODE_DEV=1).
const { _comment_fork, ...devOverride } = overlay;
fs.writeFileSync(devOverridesPath, JSON.stringify(devOverride, null, '\t'), 'utf8');
console.log('[apply-mixin] wrote product.overrides.json (gitignored, dev-only)');
console.log('[apply-mixin] dev runs now identify as: '
	+ `${merged?.nameLong} / ${merged?.applicationName} / data dir ~/${merged?.dataFolderName}-dev`);
console.log('[apply-mixin] revert with: node scripts/apply-mixin.mjs --revert');
