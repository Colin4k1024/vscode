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
const crypto = require('crypto');
const { execSync } = require('child_process');
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

// name → version index from EVERY package-lock.json in the repo (root,
// extensions/*, remote/, build/...), used to give cglicenses entries their
// real version instead of 'unknown' (L5). Cargo-side entries (no npm package
// of that name in any lockfile) keep the 'unknown' fallback.
const lockPkgVersion = (() => {
	const index = new Map();
	const walk = (dir, depth) => {
		if (depth > 4) { return; }
		let entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === '.build' || e.name.startsWith('.')) { continue; }
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				walk(p, depth + 1);
			} else if (e.name === 'package-lock.json') {
				try {
					const lock = readJson(p);
					for (const [key, value] of Object.entries(lock.packages ?? {})) {
						const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
						if (m && value && typeof value.version === 'string' && !index.has(m[1])) {
							index.set(m[1], value.version);
						}
					}
				} catch { /* an unparseable lockfile just contributes nothing */ }
			}
		}
	};
	try { walk(root, 0); } catch { /* no lockfiles readable */ }
	return (name) => index.get(name);
})();

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
for (const entry of cglicenses) {
	if (!entry.name) { continue; }
	const lockVersion = lockPkgVersion(entry.name);
	components.push({
		'bom-ref': `pkg:npm/${entry.name}@${lockVersion ?? 'unknown(cglicenses)'}`,
		type: 'library',
		name: entry.name,
		version: lockVersion ?? 'unknown',
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

// L5: the SBOM must be REPRODUCIBLE — same tree in, same document out.
// serialNumber: deterministic UUID (v5-shaped) over the sorted bom-refs
// instead of a random UUID; timestamp: SOURCE_DATE_EPOCH (reproducible-build
// convention), else the HEAD commit time, else now (last resort, and the
// doc is then not reproducible — the release flow always has a git HEAD).
const contentDigest = crypto.createHash('sha256')
	.update(components.map(c => String(c['bom-ref'])).sort().join('\n'))
	.digest('hex');
const deterministicUuid = [
	contentDigest.slice(0, 8),
	contentDigest.slice(8, 12),
	'5' + contentDigest.slice(13, 16),
	((parseInt(contentDigest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + contentDigest.slice(18, 20),
	contentDigest.slice(20, 32),
].join('-');

let timestamp;
if (process.env.SOURCE_DATE_EPOCH && /^\d+$/.test(process.env.SOURCE_DATE_EPOCH)) {
	timestamp = new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
} else {
	try {
		const headEpoch = execSync('git log -1 --format=%ct', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		timestamp = new Date(Number(headEpoch) * 1000).toISOString();
	} catch {
		timestamp = new Date().toISOString();
	}
}

// L5: a merged SBOM with implausibly few components means a source read
// silently produced nothing — fail loud instead of shipping an empty
// manifest. The upstream cgmanifest alone registers hundreds of components;
// 50 is a conservative floor. The fork-specific agent SDK pin must be
// present by construction (the loop above throws when the agents dir is
// unreadable), so assert it explicitly.
if (components.length < 50) {
	throw new Error(`SBOM has only ${components.length} components — a source merge must have failed (cgmanifest.json alone registers hundreds). Refusing to write an empty manifest.`);
}
if (!components.some(c => c.description && String(c.description).includes("Agent SDK '"))) {
	throw new Error('SBOM is missing the agent SDK pin components (build/agent-sdk/agents/*) — the D02/D09 supply-chain entries must be present.');
}

const sbom = {
	$schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
	bomFormat: 'CycloneDX',
	specVersion: '1.5',
	serialNumber: `urn:uuid:${deterministicUuid}`,
	version: 1,
	metadata: {
		timestamp,
		tools: [{ vendor: 'ColinCode', name: 'scripts/generate-sbom.sh', version: '1.0.0' }],
		component: components[0],
	},
	components: components.slice(1),
};

const out = path.join(outDir, 'sbom.cdx.json');
fs.writeFileSync(out, JSON.stringify(sbom, null, 2) + '\n');
console.log(`SBOM written: ${out}`);
console.log(`  components: ${sbom.components.length} (+1 application)`);
console.log(`  serialNumber: ${sbom.serialNumber} (deterministic over component bom-refs)`);
console.log(`  timestamp: ${timestamp} (${process.env.SOURCE_DATE_EPOCH ? 'SOURCE_DATE_EPOCH' : 'HEAD commit time'})`);
NODE_EOF
