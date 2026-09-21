/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { mergeAgentSdkResults, readAgentSdkResults, type IAgentSdkResults } from '../common.ts';

/**
 * HIGH-1 (Issue #11 review round-1): the sha256 integrity chain's build-side
 * handoff — `produce.ts` writes `{version, urlTemplate, sha256}` per SDK into
 * the results JSON and the gulp `packageTask` stamps it verbatim into
 * `product.agentSdks` via `readAgentSdkResults()`. These tests pin the
 * handoff contract: the sha256 must survive the read unchanged (a dropped
 * field here would silently ship an unverifiable product.json).
 */

const SAVED_RESULTS_FILE = process.env.AGENT_SDK_RESULTS_FILE;

function writeResults(json: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-results-'));
	const file = path.join(dir, 'results.json');
	fs.writeFileSync(file, JSON.stringify(json));
	return file;
}

suite('readAgentSdkResults (HIGH-1 sha256 handoff)', () => {

	test('returns {} when AGENT_SDK_RESULTS_FILE is unset or missing', () => {
		delete process.env.AGENT_SDK_RESULTS_FILE;
		assert.deepStrictEqual(readAgentSdkResults(), {});
		process.env.AGENT_SDK_RESULTS_FILE = path.join(os.tmpdir(), 'definitely-not-there-agent-sdk-results.json');
		assert.deepStrictEqual(readAgentSdkResults(), {});
	});

	test('passes version, urlTemplate AND sha256 through unchanged', () => {
		const entry = {
			version: '0.153.0',
			urlTemplate: 'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-codex-0.153.0/codex-0.153.0-{sdkTarget}.tgz',
			sha256: 'ab12cd34'.repeat(8),
		};
		process.env.AGENT_SDK_RESULTS_FILE = writeResults({ codex: entry });
		const results = readAgentSdkResults();
		assert.deepStrictEqual(results.codex, entry, 'the sha256 must survive the read — it is what the runtime verifies downloads against');
	});

	test('passes sha256ByTarget through unchanged (Issue #66, H1)', () => {
		// The per-target hash map is what a multi-target product.json (macOS
		// Universal) relies on — dropping it at the handoff would silently
		// ship a product.json whose x64 launches fail closed against the
		// arm64-stamped scalar.
		const entry = {
			version: '0.153.0',
			urlTemplate: 'https://example.com/codex-0.153.0-{sdkTarget}.tgz',
			sha256: 'aaaa'.repeat(16),
			sha256ByTarget: {
				'darwin-arm64': 'aaaa'.repeat(16),
				'darwin-x64': 'bbbb'.repeat(16),
			},
		};
		process.env.AGENT_SDK_RESULTS_FILE = writeResults({ codex: entry });
		assert.deepStrictEqual(readAgentSdkResults().codex, entry, 'sha256ByTarget must survive the read into product.agentSdks');
	});

	test('fails loud when the results file is not a JSON object', () => {
		// NB: arrays are objects in JS — the guard rejects scalars; an array
		// payload would fail downstream at the per-SDK entry access instead.
		process.env.AGENT_SDK_RESULTS_FILE = writeResults('not-an-object');
		assert.throws(() => readAgentSdkResults(), /not a JSON object/);
	});

	test.after(() => {
		if (SAVED_RESULTS_FILE === undefined) {
			delete process.env.AGENT_SDK_RESULTS_FILE;
		} else {
			process.env.AGENT_SDK_RESULTS_FILE = SAVED_RESULTS_FILE;
		}
	});
});

suite('mergeAgentSdkResults (Issue #66, H1 — repeated per-target runs share one results file)', () => {

	const base = (sha: string, target: string): IAgentSdkResults[string] => ({
		version: '0.153.0',
		urlTemplate: 'https://example.com/codex-0.153.0-{sdkTarget}.tgz',
		sha256: sha,
		sha256ByTarget: { [target]: sha },
	});

	test('unions sha256ByTarget across runs and tracks the fresh scalar', () => {
		const existing: IAgentSdkResults = { codex: base('aaaa'.repeat(16), 'darwin-arm64') };
		const produced: IAgentSdkResults = { codex: base('bbbb'.repeat(16), 'darwin-x64') };
		const merged = mergeAgentSdkResults(existing, produced);
		assert.deepStrictEqual(merged.codex.sha256ByTarget, {
			'darwin-arm64': 'aaaa'.repeat(16),
			'darwin-x64': 'bbbb'.repeat(16),
		});
		assert.strictEqual(merged.codex.sha256, 'bbbb'.repeat(16), 'the scalar tracks the freshly produced target (legacy single-target readers)');
	});

	test('a repeated run for the same target overwrites only that target', () => {
		const existing: IAgentSdkResults = { codex: base('aaaa'.repeat(16), 'darwin-arm64') };
		const produced: IAgentSdkResults = { codex: base('cccc'.repeat(16), 'darwin-arm64') };
		const merged = mergeAgentSdkResults(existing, produced);
		assert.deepStrictEqual(merged.codex.sha256ByTarget, { 'darwin-arm64': 'cccc'.repeat(16) });
	});

	test('keeps entries for SDKs not in this run', () => {
		const existing: IAgentSdkResults = { codex: base('aaaa'.repeat(16), 'darwin-arm64'), claude: base('dddd'.repeat(16), 'darwin-arm64') };
		const produced: IAgentSdkResults = { codex: base('bbbb'.repeat(16), 'darwin-x64') };
		const merged = mergeAgentSdkResults(existing, produced);
		assert.deepStrictEqual(merged.claude, existing.claude);
	});

	test('version drift fails loud (stale results file)', () => {
		const existing: IAgentSdkResults = { codex: base('aaaa'.repeat(16), 'darwin-arm64') };
		const produced: IAgentSdkResults = { codex: { ...base('bbbb'.repeat(16), 'darwin-x64'), version: '0.154.0' } };
		assert.throws(() => mergeAgentSdkResults(existing, produced), /version drift/);
	});

	test('urlTemplate drift fails loud (mixed distribution endpoints)', () => {
		const existing: IAgentSdkResults = { codex: base('aaaa'.repeat(16), 'darwin-arm64') };
		const produced: IAgentSdkResults = { codex: { ...base('bbbb'.repeat(16), 'darwin-x64'), urlTemplate: 'https://other.example.com/{sdkTarget}.tgz' } };
		assert.throws(() => mergeAgentSdkResults(existing, produced), /urlTemplate drift/);
	});
});
