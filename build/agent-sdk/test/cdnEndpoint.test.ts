/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License.
 *  See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { buildCdnUrl, buildCdnUrlTemplate } from '../common.ts';

const SAVED_ENV: string | undefined = process.env.AGENT_SDK_CDN_BASE;

suite('agent SDK CDN endpoint', () => {
	test('defaults to the Microsoft CDN when the env var is unset', () => {
		delete process.env.AGENT_SDK_CDN_BASE;
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'darwin-arm64'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/darwin-arm64.tgz',
		);
		assert.strictEqual(
			buildCdnUrlTemplate('codex', '0.153.0'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/{sdkTarget}.tgz',
		);
	});

	test('AGENT_SDK_CDN_BASE redirects URLs to self-hosted storage', () => {
		process.env.AGENT_SDK_CDN_BASE = 'https://cdn.example.net';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'linux-x64'),
			'https://cdn.example.net/agent-sdk/codex/0.153.0/linux-x64.tgz',
		);
		assert.strictEqual(
			buildCdnUrlTemplate('claude', '1.0.0'),
			'https://cdn.example.net/agent-sdk/claude/1.0.0/{sdkTarget}.tgz',
		);
	});

	test('trailing slashes and non-http values fall back to the default', () => {
		process.env.AGENT_SDK_CDN_BASE = 'https://cdn.example.net///';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'https://cdn.example.net/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);

		// A value without a scheme cannot form a fetchable URL — refuse it
		// rather than silently emitting `cdn.example.net/...`.
		process.env.AGENT_SDK_CDN_BASE = 'cdn.example.net';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);
	});

	test.after(() => {
		// node:test runs files in one process; restore the ambient value so
		// later suites (e.g. versionSync) are unaffected.
		if (SAVED_ENV === undefined) {
			delete process.env.AGENT_SDK_CDN_BASE;
		} else {
			process.env.AGENT_SDK_CDN_BASE = SAVED_ENV;
		}
	});
});
