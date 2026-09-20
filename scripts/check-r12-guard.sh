#!/usr/bin/env bash
# R12 guard (Issue #8, AC5): in the branded product, the effective defaults of
#   chat.agentHost.codexAgent.enabled
#   chat.editor.codex.preferAgentHost
# must be true, and must not silently flip to false because someone set
# product.quality = "stable" in the mixin.
#
# Checks (all hard-fail):
#   1. effective product.json (working tree — run after apply-mixin, or on the
#      pristine tree where the overlay is merged in memory) has quality != "stable"
#   2. the schema default of each setting in source is either literally `true`
#      or `product.quality !== 'stable'` (true under any non-stable quality)
#   3. product/default-settings.json declares both settings true
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH"

CODEX_ENABLED_SRC="$REPO_ROOT/src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts"
PREFER_AGENT_HOST_SRC="$REPO_ROOT/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts"
DEFAULT_SETTINGS="$REPO_ROOT/product/default-settings.json"

# 1. quality gate on the effective product.json (working tree wins; if the
#    mixin has not been applied, merge the overlay in memory instead).
node - "$REPO_ROOT/product.json" "$REPO_ROOT/product/product.json" <<'NODE_EOF'
const fs = require('fs');
const [basePath, overlayPath] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const overlay = fs.existsSync(overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, 'utf8')) : {};
const effective = { ...base, ...overlay };
if (effective.quality === 'stable') {
	console.error('ERROR: effective product.json has quality "stable" — this default-disables the Codex agent host (R12).');
	process.exit(1);
}
console.log(`    [1/3] effective product quality: ${effective.quality ?? '(unset)'} — not stable, OK`);
NODE_EOF

# 2. schema defaults must be `true` or `product.quality !== 'stable'`
node - "$REPO_ROOT" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];

const settings = [
	{
		id: 'chat.agentHost.codexAgent.enabled',
		file: 'src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts',
	},
	{
		id: 'chat.editor.codex.preferAgentHost',
		file: 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts',
	},
];

function resolveConstant(id) {
	// Registration keys may be constants ([SomeSettingId]:) rather than string
	// literals; find `<Const> = '<id>'` anywhere under src/vs.
	const { execSync } = require('child_process');
	try {
		const out = execSync(
			`grep -rhoE "[A-Za-z0-9_]+ = '${id}'" ${path.join(root, 'src/vs')} | head -1`,
			{ encoding: 'utf8' });
		return out.trim().split(' ')[0] || undefined;
	} catch {
		return undefined;
	}
}

for (const { id, file } of settings) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs)) {
		console.error(`ERROR: source file not found: ${abs}`);
		process.exit(1);
	}
	const src = fs.readFileSync(abs, 'utf8');
	const constName = resolveConstant(id);
	const keys = [constName ? `\\[${constName}\\]` : undefined, `'${id}'`].filter(Boolean);
	let blockStart = -1;
	for (const k of keys) {
		const m = new RegExp(`${k}\\s*:\\s*\\{`).exec(src);
		if (m && (blockStart === -1 || m.index < blockStart)) {
			blockStart = m.index;
		}
	}
	if (blockStart === -1) {
		console.error(`ERROR: could not locate schema registration block for '${id}' in ${file}`);
		process.exit(1);
	}
	// The `default:` property of this block precedes the next top-level key.
	const window = src.slice(blockStart, blockStart + 4000);
	const m = /^\s*default:\s*([^,\n]+)/m.exec(window);
	if (!m) {
		console.error(`ERROR: could not locate schema default for '${id}' in ${file}`);
		process.exit(1);
	}
	const expr = m[1].trim();
	if (expr === 'true') {
		console.log(`    [2/3] '${id}' default = true (explicit), OK`);
	} else if (expr === "product.quality !== 'stable'") {
		console.log(`    [2/3] '${id}' default = product.quality !== 'stable' (true — quality is not stable), OK`);
	} else {
		console.error(`ERROR: R12: '${id}' schema default is not guaranteed true: default: ${expr}`);
		process.exit(1);
	}
}
NODE_EOF

# 3. declarative layer must agree
node - "$DEFAULT_SETTINGS" <<'NODE_EOF'
const fs = require('fs');
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const key of ['chat.agentHost.codexAgent.enabled', 'chat.editor.codex.preferAgentHost']) {
	if (s[key] !== true) {
		console.error(`ERROR: R12: product/default-settings.json must declare "${key}": true`);
		process.exit(1);
	}
}
console.log('    [3/3] product/default-settings.json declares both R12 settings true, OK');
NODE_EOF

echo "R12 guard: PASS"
