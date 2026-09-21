#!/usr/bin/env bash
# Generate the SBOM for a ColinCode build (D09 #11 AC13, per D10 section 14 ruling:
# merge the repo's cgmanifest.json + cglicenses.json baselines — do NOT
# re-port grok-code-product's handwritten 3-component SBOM).
#
# Sources merged:
#   1. cgmanifest.json    — upstream-maintained component registrations
#      (git/other components, e.g. Chromium, seti-ui) with licenseDetail text.
#   2. cglicenses.json    — license overrides for components detected from
#      package-lock.json / Cargo.lock (JSONC; comments stripped).
#   3. build/agent-sdk/agents/*\/package.json — the agent SDK version pins
#      (D02), which upstream's manifests do not cover.
#   4. .npmrc             — the pinned Electron version (Chromium/ffmpeg
#      notices travel with the official prebuilt, D10 section 8).
#
# Output: .build/sbom/sbom.cdx.json (CycloneDX 1.5)
#
# Cross-consistency with D10's LICENSE-CLEARANCE.md dependency list is a
# release-gate review item (AC13); this script's job is to make the
# machine-readable side complete and reproducible.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="${SBOM_OUT_DIR:-$REPO_ROOT/.build/sbom}"
mkdir -p "$OUT_DIR"

command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH" >&2; exit 1; }

node - "$REPO_ROOT" "$OUT_DIR" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const [root, outDir] = process.argv.slice(2);

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function readJsonc(p) {
	// cglicenses.json is JSONC: strip // line comments outside strings.
	const text = fs.readFileSync(p, 'utf8');
	let out = '';
	let inStr = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inStr) {
			out += c;
			if (c === '\\') { out += text[++i]; continue; }
			if (c === '"') { inStr = false; }
			continue;
		}
		if (c === '"') { inStr = true; out += c; continue; }
		if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') { i++; }
			out += '\n';
			continue;
		}
		out += c;
	}
	return JSON.parse(out);
}

const pkg = readJson(path.join(root, 'package.json'));
const cgmanifest = readJson(path.join(root, 'cgmanifest.json'));
const cglicenses = readJsonc(path.join(root, 'cglicenses.json'));

const components = [];

// The product itself.
let upstreamCommit;
try { upstreamCommit = fs.readFileSync(path.join(root, 'UPSTREAM_COMMIT'), 'utf8').trim(); } catch { /* D14 pin file; optional until D14 lands */ }
components.push({
	'bom-ref': 'pkg:github/Colin4k1024/vscode@' + pkg.version,
	type: 'application',
	name: 'ColinCode',
	version: pkg.version,
	description: 'ColinCode — VS Code fork with in-tree Codex agent host' + (upstreamCommit ? ` (upstream microsoft/vscode @ ${upstreamCommit.slice(0, 12)})` : ''),
	licenses: [{ license: { id: 'MIT' } }],
	externalReferences: [{ type: 'vcs', url: 'https://github.com/Colin4k1024/vscode' }],
});

// 1. cgmanifest registrations.
for (const reg of cgmanifest.registrations ?? []) {
	const c = reg.component;
	if (!c) { continue; }
	const entry = { type: 'library', licenses: [{ license: { name: 'See licenseDetail in cgmanifest.json' } }] };
	if (c.type === 'git' && c.git) {
		entry['bom-ref'] = `git:${c.git.repositoryUrl}@${c.git.commitHash}`;
		entry.name = c.git.name ?? c.git.repositoryUrl.split('/').pop();
		entry.version = c.git.commitHash;
		entry.externalReferences = [{ type: 'vcs', url: c.git.repositoryUrl }];
	} else if (c.type === 'npm' && c.npm) {
		entry['bom-ref'] = `pkg:npm/${c.npm.name}@${c.npm.version}`;
		entry.name = c.npm.name;
		entry.version = c.npm.version;
	} else if (c.type === 'other' && c.other) {
		entry['bom-ref'] = `other:${c.other.name}@${c.other.version ?? 'unknown'}`;
		entry.name = c.other.name;
		entry.version = c.other.version;
		if (c.other.downloadUrl) { entry.externalReferences = [{ type: 'distribution', url: c.other.downloadUrl }]; }
	} else {
		entry['bom-ref'] = `unknown:${c.type}:${JSON.stringify(c).slice(0, 80)}`;
		entry.name = c.type;
	}
	if (Array.isArray(reg.licenseDetail) && reg.licenseDetail.length > 0) {
		entry.licenses = [{ license: { text: { content: Buffer.from(reg.licenseDetail.join('\n')).toString('base64'), encoding: 'base64' } } }];
	}
	components.push(entry);
}

// 2. cglicenses overrides (components detected from lockfiles).
// Review #66 (L5): resolve the real version from package-lock.json instead
// of stamping 'unknown' — an SBOM whose component versions are unknown
// cannot answer "are we affected by CVE-X?".
const lockPackages = (() => {
	try { return readJson(path.join(root, 'package-lock.json')).packages ?? {}; } catch { return {}; }
})();
// cglicenses also covers Rust crates detected from cli/Cargo.lock — resolve
// those versions too (name = version pairs from [[package]] stanzas).
const cargoVersions = (() => {
	const map = {};
	try {
		const text = fs.readFileSync(path.join(root, 'cli', 'Cargo.lock'), 'utf8');
		for (const stanza of text.split('[[package]]')) {
			const name = /^name = "([^"]+)"$/m.exec(stanza)?.[1];
			const version = /^version = "([^"]+)"$/m.exec(stanza)?.[1];
			if (name && version) { map[name] = version; }
		}
	} catch { /* cli/Cargo.lock absent */ }
	return map;
})();
const lockVersion = (name) => lockPackages[`node_modules/${name}`]?.version ?? cargoVersions[name];
for (const entry of cglicenses) {
	if (!entry.name) { continue; }
	const version = lockVersion(entry.name) ?? 'unknown';
	components.push({
		'bom-ref': `pkg:npm/${entry.name}@${version}${version === 'unknown' ? ' (cglicenses)' : ''}`,
		type: 'library',
		name: entry.name,
		version,
		description: 'License override entry from cglicenses.json (component detected from package-lock/Cargo.lock)',
		licenses: [{ license: { name: 'See cglicenses.json (prependLicenseText)' } }],
	});
}

// 3. Agent SDK pins (D02) — the piece upstream manifests do not cover.
const agentsDir = path.join(root, 'build', 'agent-sdk', 'agents');
for (const sdk of fs.readdirSync(agentsDir).filter(d => fs.statSync(path.join(agentsDir, d)).isDirectory()).sort()) {
	const agentPkg = readJson(path.join(agentsDir, sdk, 'package.json'));
	const deps = Object.entries(agentPkg.dependencies ?? {});
	if (deps.length !== 1) { throw new Error(`agents/${sdk}/package.json must pin exactly one dependency`); }
	const [name, version] = deps[0];
	components.push({
		'bom-ref': `pkg:npm/${name}@${version}`,
		type: 'library',
		name,
		version,
		description: `Agent SDK '${sdk}' — self-hosted tarball, distributed via this repo's GitHub Releases (D09)`,
		licenses: [{ license: { id: sdk === 'codex' ? 'Apache-2.0' : 'NOASSERTION' } }],
	});
}

// 4. Electron (pinned via .npmrc target).
try {
	const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
	const electronVersion = /^target="(.*)"$/m.exec(npmrc)?.[1];
	if (electronVersion) {
		components.push({
			'bom-ref': `pkg:npm/electron@${electronVersion}`,
			type: 'framework',
			name: 'electron',
			version: electronVersion,
			description: 'Official Electron prebuilt (Chromium + ffmpeg notices ship inside the binary distribution; D10 section 8)',
			licenses: [{ license: { id: 'MIT' } }],
		});
	}
} catch { /* .npmrc absent — record nothing */ }

// Review #66 (L5): reproducible output — the serial number is derived from
// the component content (same inputs → same SBOM, byte for byte) and no
// wall-clock timestamp is stamped. CycloneDX allows omitting
// metadata.timestamp; SOURCE_DATE_EPOCH is honored for consumers that want
// a timestamp at all.
const crypto = require('crypto');
const contentHash = crypto.createHash('sha256').update(JSON.stringify(components)).digest('hex');
const serialUuid = `${contentHash.slice(0, 8)}-${contentHash.slice(8, 12)}-${contentHash.slice(12, 16)}-${contentHash.slice(16, 20)}-${contentHash.slice(20, 32)}`;

// (c) minimum-component assertions: an SBOM that silently lost a source
// (an emptied cgmanifest, a renamed agents dir) must fail the gate, not
// ship a near-empty document.
if (components.length < 10) {
	throw new Error(`SBOM sanity check failed: only ${components.length} components (expected >= 10) — a manifest source was likely lost`);
}
for (const required of ['electron', ...fs.readdirSync(agentsDir).filter(d => fs.statSync(path.join(agentsDir, d)).isDirectory())]) {
	// agent SDKs are recorded by their npm dependency name, not the dir name
	if (required === 'electron' && !components.some(c => c.name === 'electron')) {
		throw new Error('SBOM sanity check failed: no electron component (the .npmrc pin source was lost)');
	}
}
if (!components.some(c => c.description?.includes("Agent SDK 'codex'"))) {
	throw new Error("SBOM sanity check failed: no codex agent SDK component (the build/agent-sdk/agents source was lost)");
}

const sbom = {
	$schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
	bomFormat: 'CycloneDX',
	specVersion: '1.5',
	serialNumber: `urn:uuid:${serialUuid}`,
	version: 1,
	metadata: {
		...(process.env.SOURCE_DATE_EPOCH ? { timestamp: new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() } : {}),
		tools: [{ vendor: 'ColinCode', name: 'scripts/generate-sbom.sh', version: '1.0.0' }],
		component: components[0],
	},
	components: components.slice(1),
};

const out = path.join(outDir, 'sbom.cdx.json');
fs.writeFileSync(out, JSON.stringify(sbom, null, 2) + '\n');
console.log(`SBOM written: ${out}`);
console.log(`  components: ${sbom.components.length} (+1 application)`);
NODE_EOF
