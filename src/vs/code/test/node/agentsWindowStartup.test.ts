/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { upcastPartial } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { NativeParsedArgs } from '../../../platform/environment/common/argv.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import product from '../../../platform/product/common/product.js';
import { shouldOpenAgentsWindowOnStartup } from '../../node/agentsWindowStartup.js';

suite('shouldOpenAgentsWindowOnStartup', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const agentsProduct = upcastPartial<IProductService>({ defaultWindow: 'agents' });
	const classicProduct = upcastPartial<IProductService>({ defaultWindow: undefined });

	function args(overrides: Partial<NativeParsedArgs> = {}): NativeParsedArgs {
		return upcastPartial<NativeParsedArgs>({ _: [], ...overrides });
	}

	test('bare launch opens the Agents window when the product default is agents', () => {
		assert.strictEqual(shouldOpenAgentsWindowOnStartup(agentsProduct, args(), []), true);
	});

	test('without the product flag startup behavior is unchanged', () => {
		assert.strictEqual(shouldOpenAgentsWindowOnStartup(classicProduct, args(), []), false);
	});

	test('--agents is left to the dedicated branch', () => {
		assert.strictEqual(shouldOpenAgentsWindowOnStartup(agentsProduct, args({ agents: true }), []), false);
	});

	test('explicit open intents keep the regular workbench window', () => {
		const cases: { name: string; args: NativeParsedArgs; macOpenFiles?: string[] }[] = [
			{ name: 'cli path', args: args({ _: ['.'] }) },
			{ name: 'folder uri', args: args({ 'folder-uri': ['vscode-remote://ssh-remote+host/ws'] }) },
			{ name: 'file uri', args: args({ 'file-uri': ['file:///tmp/a.txt'] }) },
			{ name: 'new window', args: args({ 'new-window': true }) },
			{ name: 'reuse window', args: args({ 'reuse-window': true }) },
			{ name: 'profile', args: args({ profile: 'work' }) },
			{ name: 'temp profile', args: args({ 'profile-temp': true }) },
			{ name: 'wait', args: args({ wait: true }) },
			{ name: 'diff', args: args({ diff: true }) },
			{ name: 'merge', args: args({ merge: true }) },
			{ name: 'remote', args: args({ remote: 'ssh-remote+host' }) },
			{ name: 'mac open-file', args: args(), macOpenFiles: ['/tmp/a.txt'] },
		];
		for (const { name, args: a, macOpenFiles } of cases) {
			assert.strictEqual(shouldOpenAgentsWindowOnStartup(agentsProduct, a, macOpenFiles ?? []), false, name);
		}
	});

	test('benign flags do not block the Agents window default', () => {
		const benign: Partial<NativeParsedArgs>[] = [
			{ 'skip-add-to-recently-opened': true },
			{ verbose: true },
			{ 'user-data-dir': '/tmp/ud' },
			{ 'agents-user-data-dir': '/tmp/aud' },
		];
		for (const overrides of benign) {
			assert.strictEqual(shouldOpenAgentsWindowOnStartup(agentsProduct, args(overrides), []), true, JSON.stringify(overrides));
		}
	});
});

suite('product defaults (D07)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the Agents window is the product\'s default desktop form', () => {
		assert.strictEqual(product.defaultWindow, 'agents');
	});

	test('sessionsWindowAllowedExtensions is an explicitly empty allow-list', () => {
		// D07 whitelist ruling: no third-party extension is allow-listed into the
		// Agents window. The sessions window already runs the chat extension and
		// capability-vetted built-ins; every addition to this list requires an
		// explicit product/security review, so the pin stays at the empty set.
		assert.deepStrictEqual(product.sessionsWindowAllowedExtensions, []);
	});
});
