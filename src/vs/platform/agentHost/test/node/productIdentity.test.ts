/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildExternalOpenSessionLinkUri, parseExternalOpenSessionLinkUri, parseOpenSessionLinkUri } from '../../common/openSessionLink.js';

// codex-desktop D06 (issue #8): guards for the product identity mixin.
//
// The shipped identity is the shallow merge of the upstream root product.json
// and the fork overlay in product/product.json (applied by
// scripts/apply-mixin.mjs; the dev path goes through the gitignored
// product.overrides.json that src/bootstrap-meta.ts consumes). This test
// re-implements the merge and pins the two invariants the issue calls out:
//
//   - acceptance 5 (R12): chat.agentHost.codexAgent.enabled and
//     chat.editor.codex.preferAgentHost must effectively default to TRUE.
//     Both are registered as `default: product.quality !== 'stable'`, so the
//     merged product must never carry quality:'stable' (there is no
//     product-level configuration-defaults injection in VS Code 1.139 that
//     could override them - product/default-settings.json is a validated
//     record, not an applied mechanism).
//   - acceptance 4: the branded urlProtocol deep link
//     `<protocol>://agents/agent-host-session/<provider>/<id>` keeps parsing.

function repoRelative(...segments: string[]): string {
	// Compiled to out/vs/platform/agentHost/test/node/; swap out/ -> src/ and
	// walk up to the repository root (same technique as agentService.test.ts).
	const thisFile = fileURLToPath(import.meta.url);
	const srcFile = thisFile.replace(/[/\\]out[/\\]/, m => m.replace('out', 'src'));
	const testDir = join(srcFile, '..');
	return join(testDir, '..', '..', '..', '..', '..', '..', ...segments);
}

function readJson(repoPath: string): any {
	return JSON.parse(readFileSync(repoPath, 'utf-8'));
}

const R12_KEYS = ['chat.agentHost.codexAgent.enabled', 'chat.editor.codex.preferAgentHost'] as const;

function mergedProduct(): { base: any; overlay: any; merged: any } {
	const base = readJson(repoRelative('product.json'));
	const overlay = readJson(repoRelative('product', 'product.json'));
	return { base, overlay, merged: { ...base, ...overlay } };
}

suite('productIdentity (D06 fork branding)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('fork overlay replaces every identity field with non-Code-OSS values', () => {
		const { base, overlay, merged } = mergedProduct();

		assert.strictEqual(merged.nameShort, 'OpenAgents');
		assert.strictEqual(merged.nameLong, 'OpenAgents');
		assert.strictEqual(merged.applicationName, 'open-agents');
		assert.strictEqual(merged.dataFolderName, '.open-agents');
		assert.strictEqual(merged.urlProtocol, 'open-agents');

		// Coexistence with both official VS Code and the Code-OSS base
		// (acceptance 3, field-level): identity-bearing fields must all be
		// fork-owned and distinct from the base.
		const coexistenceFields = [
			'applicationName', 'dataFolderName', 'sharedDataFolderName', 'urlProtocol',
			'win32MutexName', 'win32RegValueName', 'win32AppUserModelId',
			'win32TunnelServiceMutex', 'win32TunnelMutex', 'darwinBundleIdentifier',
			'linuxDesktopName', 'serverApplicationName', 'serverDataFolderName',
			'tunnelApplicationName',
		];
		for (const field of coexistenceFields) {
			assert.ok(typeof overlay[field] === 'string' && overlay[field].length > 0, `overlay must own "${field}"`);
			assert.notStrictEqual(overlay[field], base[field], `field "${field}" must differ from the Code-OSS base`);
		}

		// Trademark guard (D10): no Microsoft/OpenAI marks in name-like fields.
		const banned = [/visual\s+studio\s+code/i, /\bvscode\b/i, /code\s*-\s*oss/i, /\bcodex\b/i];
		for (const field of ['nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'win32DirName', 'darwinBundleIdentifier', 'linuxDesktopName', 'urlProtocol']) {
			for (const token of banned) {
				assert.ok(!token.test(overlay[field] ?? ''), `identity field "${field}" must not match ${token}`);
			}
		}
	});

	test('R12: Codex agent settings effectively default to enabled', () => {
		const { merged } = mergedProduct();

		// The registered default for both keys is `product.quality !== 'stable'`
		// (agentHostStarter.config.contribution.ts for
		// chat.agentHost.codexAgent.enabled, chat.shared.contribution.ts for
		// chat.editor.codex.preferAgentHost). Verify that derivation is still
		// what the sources register...
		for (const source of [
			'src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts',
			'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts',
		]) {
			const text = readFileSync(repoRelative(...source.split('/')), 'utf-8');
			assert.ok(
				/default:\s*product\.quality\s*!==\s*'stable'/.test(text),
				`${source} no longer derives a default from product.quality - re-audit the R12 keys (${R12_KEYS.join(', ')})`
			);
		}

		// ...and that the merged product keeps that expression true.
		assert.notStrictEqual(merged.quality, 'stable',
			`quality:"${merged.quality}" would flip ${R12_KEYS.join(' and ')} to their disabled default (R12); remove "quality" from product/product.json`);

		// The product/default-settings.json record agrees (it is validated by
		// scripts/apply-mixin.mjs as well; there is no auto-apply mechanism in
		// 1.139, so the quality-free product IS the enforcement).
		const defaultSettings = readJson(repoRelative('product', 'default-settings.json'));
		for (const key of R12_KEYS) {
			assert.strictEqual(defaultSettings[key], true, `product/default-settings.json must record "${key}": true`);
		}
	});

	test('branded urlProtocol deep link still parses into an agent-host session link', () => {
		const { merged } = mergedProduct();
		const protocol = merged.urlProtocol;
		assert.ok(typeof protocol === 'string' && protocol.length > 0, 'merged product must define urlProtocol');
		assert.notStrictEqual(protocol, 'code-oss');
		assert.notStrictEqual(protocol, 'vscode');

		// Acceptance 4: <newProtocol>://agents/agent-host-session/codex/<id>
		const external = URI.parse(`${protocol}://agents/agent-host-session/codex/sess-123`);
		const internal = parseExternalOpenSessionLinkUri(external, protocol);
		assert.ok(internal, 'external open-session link must parse under the branded protocol');
		assert.strictEqual(internal!.scheme, 'agent-host-session');
		assert.strictEqual(internal!.authority, 'codex');
		assert.strictEqual(parseOpenSessionLinkUri(internal!)?.toString(), URI.parse('codex:/sess-123').toString());

		// Round-trip through the builder used by the product surfaces.
		const built = buildExternalOpenSessionLinkUri(protocol, 'codex:/sess-123', 'chat-9', 'turn-1');
		const parsed = parseExternalOpenSessionLinkUri(built, protocol);
		assert.strictEqual(parsed?.toString(true), 'agent-host-session://codex/sess-123?chat=chat-9&turn=turn-1');

		// The old Code-OSS protocol must NOT resolve under the new identity.
		assert.strictEqual(parseExternalOpenSessionLinkUri(`code-oss://agents/agent-host-session/codex/sess-123`, protocol), undefined);
	});

	test('codex app-server client identifies as the fork, not vscode_agent_host (D10 section 3)', () => {
		const source = readFileSync(repoRelative('src/vs/platform/agentHost/node/codex/codexAgent.ts'), 'utf-8');
		assert.ok(/CLIENT_INFO_NAME = 'openagents_desktop'/.test(source), 'clientInfo.name must be the fork identity openagents_desktop');
		assert.ok(!/name:\s*'vscode_agent_host'/.test(source), 'clientInfo.name must not reuse Microsoft-registered vscode_agent_host');
	});
});
