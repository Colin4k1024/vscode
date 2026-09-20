/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { getSdkTargetForBuild } from '../common.ts';

/**
 * AC5 (Issue #11), build-side half: the (vscodePlatform, arch) → sdkTarget
 * mapping the produce pipeline stamps. The runtime mirror
 * (`resolveSdkTarget` in agentSdkDownloader.ts) has its own exhaustive
 * suite in src/vs/platform/agentHost/test/node/agentSdkDownloader.test.ts;
 * this suite locks the build-side table so the two cannot drift apart.
 */
suite('getSdkTargetForBuild (AC5 exhaustive matrix)', () => {

	test('{darwin,linux,win32} × {x64,arm64} → the correct SKU, for every SDK kind', () => {
		// codex = single linux-* SKU (statically musl-linked);
		// claude = separate musl SKUs. Both must agree on the base matrix.
		for (const sdk of ['codex', 'claude']) {
			assert.deepStrictEqual(
				{
					'darwin-x64': getSdkTargetForBuild('darwin', 'x64', sdk),
					'darwin-arm64': getSdkTargetForBuild('darwin', 'arm64', sdk),
					'linux-x64': getSdkTargetForBuild('linux', 'x64', sdk),
					'linux-arm64': getSdkTargetForBuild('linux', 'arm64', sdk),
					'win32-x64': getSdkTargetForBuild('win32', 'x64', sdk),
					'win32-arm64': getSdkTargetForBuild('win32', 'arm64', sdk),
				},
				{
					'darwin-x64': 'darwin-x64',
					'darwin-arm64': 'darwin-arm64',
					'linux-x64': 'linux-x64',
					'linux-arm64': 'linux-arm64',
					'win32-x64': 'win32-x64',
					'win32-arm64': 'win32-arm64',
				},
				`${sdk}: base matrix`,
			);
		}
	});

	test('musl Linux: codex stays on the plain linux-* SKU; claude gets -musl', () => {
		for (const arch of ['x64', 'arm64']) {
			assert.strictEqual(getSdkTargetForBuild('alpine', arch, 'codex'), `linux-${arch}`, `codex alpine ${arch}: no -musl suffix`);
			assert.strictEqual(getSdkTargetForBuild('alpine', arch, 'claude'), `linux-${arch}-musl`, `claude alpine ${arch}: -musl suffix`);
		}
		// Legacy Alpine x64 encoding must normalize to the same result.
		assert.strictEqual(getSdkTargetForBuild('linux', 'alpine', 'codex'), 'linux-x64');
		assert.strictEqual(getSdkTargetForBuild('linux', 'alpine', 'claude'), 'linux-x64-musl');
	});

	test('armhf and unknown platforms → undefined (no SDK ships for them)', () => {
		assert.strictEqual(getSdkTargetForBuild('linux', 'armhf', 'codex'), undefined);
		assert.strictEqual(getSdkTargetForBuild('linux', 'armhf', 'claude'), undefined);
		assert.strictEqual(getSdkTargetForBuild('web' as never, 'x64', 'codex'), undefined);
		assert.strictEqual(getSdkTargetForBuild('darwin', 'ia32', 'codex'), undefined);
		assert.strictEqual(getSdkTargetForBuild('freebsd' as never, 'x64', 'codex'), undefined);
	});
});
