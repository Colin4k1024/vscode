/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { buildCdnUrl, buildCdnUrlTemplate } from '../common.ts';

const SAVED_ENV: string | undefined = process.env.AGENT_SDK_CDN_BASE;
const SAVED_TEMPLATE_ENV: string | undefined = process.env.AGENT_SDK_URL_TEMPLATE;

suite('agent SDK CDN endpoint', () => {
	test('defaults to the Microsoft CDN when the env var is unset or empty', () => {
		delete process.env.AGENT_SDK_CDN_BASE;
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'darwin-arm64'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/darwin-arm64.tgz',
		);
		assert.strictEqual(
			buildCdnUrlTemplate('codex', '0.153.0'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/{sdkTarget}.tgz',
		);

		process.env.AGENT_SDK_CDN_BASE = '';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'linux-x64'),
			'https://main.vscode-cdn.net/agent-sdk/codex/0.153.0/linux-x64.tgz',
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

	test('accepts uppercase schemes and strips trailing slashes; keeps path prefixes; trims whitespace', () => {
		process.env.AGENT_SDK_CDN_BASE = 'HTTPS://cdn.example.net';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'HTTPS://cdn.example.net/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);

		process.env.AGENT_SDK_CDN_BASE = '  https://cdn.example.net/  ';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'https://cdn.example.net/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);

		process.env.AGENT_SDK_CDN_BASE = 'https://cdn.example.net///';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'https://cdn.example.net/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);

		process.env.AGENT_SDK_CDN_BASE = 'https://cdn.example.net/base/';
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'win32-x64'),
			'https://cdn.example.net/base/agent-sdk/codex/0.153.0/win32-x64.tgz',
		);
	});

	test('AGENT_SDK_URL_TEMPLATE overrides the whole URL shape (GitHub Releases style)', () => {
		process.env.AGENT_SDK_URL_TEMPLATE = 'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-{sdk}-{sdkVersion}/{sdk}-{sdkVersion}-{sdkTarget}.tgz';
		// AGENT_SDK_CDN_BASE must be ignored while the template override is set.
		process.env.AGENT_SDK_CDN_BASE = 'https://cdn.example.net';
		assert.strictEqual(
			buildCdnUrlTemplate('codex', '0.153.0'),
			'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-codex-0.153.0/codex-0.153.0-{sdkTarget}.tgz',
		);
		assert.strictEqual(
			buildCdnUrl('codex', '0.153.0', 'darwin-arm64'),
			'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-codex-0.153.0/codex-0.153.0-darwin-arm64.tgz',
		);
		delete process.env.AGENT_SDK_URL_TEMPLATE;
	});

	test('AGENT_SDK_URL_TEMPLATE without {sdkTarget} fails loud (macOS Universal hazard)', () => {
		process.env.AGENT_SDK_URL_TEMPLATE = 'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-codex/codex.tgz';
		assert.throws(() => buildCdnUrlTemplate('codex', '0.153.0'), /must contain a literal \{sdkTarget\} placeholder/);
		process.env.AGENT_SDK_URL_TEMPLATE = 'not-a-url-{sdkTarget}';
		assert.throws(() => buildCdnUrlTemplate('codex', '0.153.0'), /must be an http\(s\) URL/);
		delete process.env.AGENT_SDK_URL_TEMPLATE;
	});

	test('every platform job emits the identical urlTemplate (AC4: Universal prerequisite)', () => {
		// The template is a pure function of (sdk, sdkVersion) — the platform
		// only enters at runtime via {sdkTarget} substitution. Lock that in:
		// two invocations for two different platform jobs must be identical.
		const a = buildCdnUrlTemplate('codex', '0.153.0');
		const b = buildCdnUrlTemplate('codex', '0.153.0');
		assert.strictEqual(a, b);
		assert.ok(a.includes('{sdkTarget}'));
	});

	test('a set-but-unusable value fails loud instead of falling back to the Microsoft CDN', () => {
		process.env.AGENT_SDK_CDN_BASE = 'cdn.example.net';
		assert.throws(() => buildCdnUrl('codex', '0.153.0', 'win32-x64'), /AGENT_SDK_CDN_BASE must be an http\(s\) URL/);

		process.env.AGENT_SDK_CDN_BASE = 'ftp://cdn.example.net';
		assert.throws(() => buildCdnUrlTemplate('codex', '0.153.0'), /AGENT_SDK_CDN_BASE must be an http\(s\) URL/);
	});

	test.after(() => {
		// Restore the ambient values for whatever runs after this file.
		if (SAVED_ENV === undefined) {
			delete process.env.AGENT_SDK_CDN_BASE;
		} else {
			process.env.AGENT_SDK_CDN_BASE = SAVED_ENV;
		}
		if (SAVED_TEMPLATE_ENV === undefined) {
			delete process.env.AGENT_SDK_URL_TEMPLATE;
		} else {
			process.env.AGENT_SDK_URL_TEMPLATE = SAVED_TEMPLATE_ENV;
		}
	});
});
