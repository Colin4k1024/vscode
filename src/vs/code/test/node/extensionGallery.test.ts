/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';

// D15 (Issue #17): the extension gallery is Open VSX, injected via the D06
// mixin overlay (product/product.json) so the upstream product.json stays
// 0-diff in git. Microsoft Marketplace is off-limits for third-party builds
// (D10 ToS ruling). These tests pin the overlay values and the merged
// (shipped) configuration; scripts/audit-network-egress.sh gates the same
// ruling in CI on the merged product.
suite('extension gallery (D15)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const repoRootUrl = new URL('../../../../../', import.meta.url);
	const readRepoFile = (rel: string) => readFileSync(fileURLToPath(new URL(rel, repoRootUrl)), 'utf8');
	const base = JSON.parse(readRepoFile('product.json')) as Record<string, unknown>;
	const overlay = JSON.parse(readRepoFile('product/product.json')) as Record<string, unknown>;

	// Mirror scripts/apply-mixin.sh merge semantics (overlay wins; null deletes).
	function merged(): Record<string, unknown> {
		const result = { ...base, ...overlay };
		for (const [key, value] of Object.entries(overlay)) {
			if (value === null) {
				delete result[key];
			}
		}
		return result;
	}

	test('the gallery lives in the overlay, not the upstream base', () => {
		// D06 mixin contract: the committed upstream product.json stays pristine,
		// so the gallery configuration comes from product/product.json. In a
		// worktree with the mixin applied (the standard dev flow), the
		// working-tree product.json legitimately carries the overlay value.
		if (base.extensionsGallery !== undefined) {
			assert.deepStrictEqual(base.extensionsGallery, overlay.extensionsGallery,
				'base product.json extensionsGallery must be the overlay value (mixin applied), not an independent configuration');
		}
	});

	test('the mixin overlay pins the gallery to Open VSX', () => {
		assert.deepStrictEqual(overlay.extensionsGallery, {
			serviceUrl: 'https://open-vsx.org/vscode/gallery',
			itemUrl: 'https://open-vsx.org/vscode/item',
			publisherUrl: 'https://open-vsx.org/namespace',
			resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
		});
	});

	test('the merged (shipped) product configuration points at Open VSX and never at the MS Marketplace', () => {
		const m = merged();
		const gallery = m.extensionsGallery as Record<string, string> | undefined;
		assert.ok(gallery, 'merged product.json must define extensionsGallery');
		assert.strictEqual(gallery.serviceUrl, 'https://open-vsx.org/vscode/gallery');
		for (const [key, value] of Object.entries(gallery)) {
			assert.ok(value.startsWith('https://open-vsx.org/'), `extensionsGallery.${key} must be an open-vsx.org URL, got: ${value}`);
		}
		// D10: no Microsoft Marketplace host anywhere in the shipped config.
		const text = JSON.stringify(m);
		for (const host of ['marketplace.visualstudio.com', 'vsassets.io', 'gallerycdn', 'vscode.blob.core.windows.net']) {
			assert.ok(!text.includes(host), `merged product.json contains MS Marketplace host '${host}'`);
		}
	});

	test('pins the gallery-presence assertion (G9 gate) in the egress audit and beta gates', () => {
		// Text pin, not a behavioral execution: the behavioral half was verified
		// at review time (deleting the overlay key makes both scripts exit 1).
		// G9 regression gate: scripts/audit-network-egress.sh must contain the
		// gallery-presence assertion — an `else` branch on the gallery-exists
		// check that errors when the merged configuration has no
		// extensionsGallery. Deleting the mixin key without deleting that
		// assertion must stay a CI failure. The beta-gates script mirrors the
		// same gate and is pinned here too.
		const audit = readRepoFile('scripts/audit-network-egress.sh');
		const failureText = 'merged product.json has no extensionsGallery';
		const failureIdx = audit.indexOf(failureText);
		assert.ok(failureIdx !== -1,
			'audit-network-egress.sh must fail when the merged product.json has no extensionsGallery (G9 regression gate)');
		// The failure must live in the else branch of the gallery-exists check
		// (positionally: after `if (gallery) {` and after its `} else {`),
		// not just anywhere in the script.
		const ifIdx = audit.indexOf('if (gallery) {');
		const elseIdx = audit.lastIndexOf('} else {', failureIdx);
		assert.ok(ifIdx !== -1 && elseIdx > ifIdx && failureIdx > elseIdx,
			'the gallery-presence failure must live in the else branch of the if (gallery) check, not just anywhere in the script');
		const betaGates = readRepoFile('scripts/verify-beta-gates.sh');
		assert.ok(betaGates.includes('GATE FAILED: effective product.json has no extensionsGallery'),
			'verify-beta-gates.sh must hard-fail when the effective product.json has no extensionsGallery (D15-06: both presence assertions are removed together on a deliberate rollback)');
	});

	test('Open VSX is not on the network-egress denylist', () => {
		// scripts/audit-network-egress.sh is denylist-based; the gallery host
		// must stay off it for the audit to remain green.
		const audit = readRepoFile('scripts/audit-network-egress.sh');
		assert.ok(!/["']open-vsx\.org["']/.test(audit),
			'open-vsx.org must not be added to DENYLIST_HOSTS');
	});
});
