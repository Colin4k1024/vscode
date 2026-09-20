#!/usr/bin/env bash
# D08 / Issue #10 AC1 — static network-egress audit.
#
# Two layers:
#   1. Shipped product configuration: merges product/product.json (the ColinCode
#      mixin overlay) onto the upstream product.json IN MEMORY (the working tree
#      is not mutated) and asserts the merged configuration contains no
#      denylisted Microsoft/GitHub egress endpoints and that the D08 removals
#      (defaultChatAgent, webviewContentExternalBaseUrlTemplate) took effect.
#   2. Code scan: greps non-test sources for denylisted egress hosts; every hit
#      must be justified by an entry in scripts/network-egress-allowlist.txt
#      (format: "<relative/path>\t<host-substring>" per line).
#
# The dynamic half of AC1 (mitmproxy capture of cold start / one Codex turn /
# one webview) is a manual verification step recorded in the PR description —
# see .agents/research/codex-desktop/D08-DECISIONS.md (D08-01).
#
# Usage: bash scripts/audit-network-egress.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOWLIST="$SCRIPT_DIR/network-egress-allowlist.txt"
cd "$REPO_ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node not found on PATH (use node@24)"

# Hosts the shipped product must never contact implicitly (telemetry pipelines,
# CDN bootstraps, Copilot telemetry). User-initiated documentation links
# (aka.ms, github.com) are deliberately NOT denylisted here — they are not
# automatic egress; the mixin layer separately removes the Copilot config that
# referenced them.
DENYLIST_HOSTS=(
	'vscode-cdn.net'
	'vortex.data.microsoft.com'
	'dc.services.visualstudio.com'
	'dc.trafficmanager.net'
	'events.data.microsoft.com'
	'applicationinsights.io'
	'applicationinsights.azure.com'
	'applicationinsights.microsoft.com'
	'exp-tas.com'
	'copilot-telemetry.githubusercontent.com'
)

echo "==> [1/2] Shipped product configuration (upstream product.json + product/product.json overlay)"

node - "${DENYLIST_HOSTS[@]}" <<'NODE_EOF'
const fs = require('fs');
const denylist = process.argv.slice(2);

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

// D08 removals must be effective in the shipped configuration
if ('defaultChatAgent' in merged) {
	err('merged product.json still defines defaultChatAgent (GitHub Copilot default chat agent)');
}
if ('webviewContentExternalBaseUrlTemplate' in merged) {
	err('merged product.json still defines webviewContentExternalBaseUrlTemplate (vscode-cdn.net)');
}
if (merged.enableTelemetry !== false) {
	err('merged product.json must set enableTelemetry: false (no first-party telemetry pipeline)');
}
const trusted = merged.trustedExtensionAuthAccess ?? {};
for (const [provider, extensionIds] of Object.entries(trusted)) {
	for (const id of extensionIds) {
		if (/copilot/i.test(id)) {
			err(`merged product.json trustedExtensionAuthAccess still trusts '${id}' for '${provider}'`);
		}
	}
}

// No denylisted egress host anywhere in the shipped configuration
const text = JSON.stringify(merged);
for (const host of denylist) {
	if (text.includes(host)) {
		err(`merged product.json contains denylisted egress host '${host}'`);
	}
}

// D15 (Issue #17) gallery pin: the shipped gallery must be Open VSX, and no
// Microsoft Marketplace host may appear in the merged configuration (D10 ToS
// ruling — Marketplace Offerings are licensed for official Visual Studio
// products only). Host check covers the whole merged config (gallery URLs,
// tips, templates), not just extensionsGallery.
const MS_MARKETPLACE_HOSTS = ['marketplace.visualstudio.com', 'vsassets.io', 'gallerycdn', 'vscode.blob.core.windows.net'];
for (const host of MS_MARKETPLACE_HOSTS) {
	if (text.includes(host)) {
		err(`merged product.json contains MS Marketplace host '${host}' (D10: third-party builds must not point at the Marketplace)`);
	}
}
const gallery = merged.extensionsGallery;
if (gallery) {
	for (const [key, value] of Object.entries(gallery)) {
		if (typeof value === 'string' && value && !value.startsWith('https://open-vsx.org/')) {
			err(`merged product.json extensionsGallery.${key} must be an open-vsx.org URL, got: ${value}`);
		}
	}
	if (!gallery.serviceUrl) {
		err('merged product.json extensionsGallery.serviceUrl must be set');
	}
} else {
	// G9 regression gate (D15): deleting the gallery from the mixin must fail
	// here, not silently return the shipped product to "no marketplace".
	err('merged product.json has no extensionsGallery — D15 configured Open VSX; removing it regresses G9 (no marketplace). Delete this assertion too if that is a deliberate rollback.');
}


if (failed) {
	process.exit(1);
}
console.log('    shipped product.json: no defaultChatAgent, no vscode-cdn.net template, enableTelemetry=false, no denylisted hosts, gallery pinned to Open VSX: OK');
NODE_EOF

echo "==> [2/2] Code scan for denylisted egress hosts (non-test sources)"

[ -f "$ALLOWLIST" ] || fail "allowlist not found: $ALLOWLIST"

violations=0
for host in "${DENYLIST_HOSTS[@]}"; do
	# Fixed-string scan; exclude tests, generated protocol types, and comments-only
	# documentation directories. Justified hits are covered by the allowlist.
	while IFS= read -r line; do
		file="${line%%:*}"
		rel="${file#./}"
		if grep -qF "$rel	$host" "$ALLOWLIST" || grep -qF "$rel	*" "$ALLOWLIST"; then
			echo "    allowlisted: $rel ($host)"
		else
			echo "ERROR: unjustified egress host reference: $line" >&2
			violations=$((violations + 1))
		fi
	# node_modules is excluded: it is build input (third-party dependency
	# source), not fork code. dist/ and out/ are excluded: they are generated
	# build outputs (bundled copies of dependencies), not source. Egress in
	# the SHIPPED bits is covered by the artifact-level gates
	# (check-no-copilot-artifacts / branding residue on the packaged app) and
	# the D08 dynamic verification. CI runs this scan before npm ci/build, so
	# the exclusions also keep local and CI results equal.
	done < <(grep -rn --include='*.ts' --include='*.js' --include='*.json' \
		--exclude-dir=test --exclude-dir=tests --exclude-dir=node_modules \
		--exclude-dir=dist --exclude-dir=out \
		-F "$host" src build product product.json extensions 2>/dev/null || true)
done

if [ "$violations" -gt 0 ]; then
	fail "$violations unjustified egress host reference(s) found (justify in scripts/network-egress-allowlist.txt with a comment, or remove)"
fi
echo "    code scan: all denylisted-host references are allowlisted: OK"
echo "==> Network egress audit passed"
