/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { mergeAgentSdkResults, readAgentSdkResults, readAgentSdkResultsFile, type IAgentSdkResults } from '../common.ts';

/**
 * HIGH-1 (Issue #11 review round-1) + H1 (Issue #66): the sha256 integrity
 * chain's build-side handoff — `produce.ts` writes
 * `{version, urlTemplate, sha256ByTarget}` per SDK into the results JSON and
 * the gulp `packageTask` stamps it verbatim into `product.agentSdks` via
 * `readAgentSdkResults()`. These tests pin the handoff contract: the
 * per-target hashes must survive the read unchanged (a dropped field here
 * would silently ship an unverifiable product.json), and the merge must
 * accumulate per-target entries across sequential produce runs instead of
 * clobbering them (the macOS Universal case).
 */

const SAVED_RESULTS_FILE = process.env.AGENT_SDK_RESULTS_FILE;

function writeResults(json: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-results-'));
	const file = path.join(dir, 'results.json');
	fs.writeFileSync(file, JSON.stringify(json));
	return file;
}

const URL_TEMPLATE = 'https://github.com/Colin4k1024/vscode/releases/download/agent-sdk-codex-0.153.0/codex-0.153.0-{sdkTarget}.tgz';

suite('readAgentSdkResults (HIGH-1 sha256 handoff)', () => {

	test('returns {} when AGENT_SDK_RESULTS_FILE is unset or missing', () => {
		delete process.env.AGENT_SDK_RESULTS_FILE;
		assert.deepStrictEqual(readAgentSdkResults(), {});
		process.env.AGENT_SDK_RESULTS_FILE = path.join(os.tmpdir(), 'definitely-not-there-agent-sdk-results.json');
		assert.deepStrictEqual(readAgentSdkResults(), {});
	});

	test('passes version, urlTemplate AND sha256ByTarget through unchanged', () => {
		const entry = {
			version: '0.153.0',
			urlTemplate: URL_TEMPLATE,
			sha256ByTarget: { 'darwin-arm64': 'ab12cd34'.repeat(8), 'darwin-x64': 'ef56ab78'.repeat(8) },
		};
		process.env.AGENT_SDK_RESULTS_FILE = writeResults({ codex: entry });
		const results = readAgentSdkResults();
		assert.deepStrictEqual(results.codex, entry, 'the per-target hashes must survive the read — they are what the runtime verifies downloads against');
	});

	test('passes a legacy scalar sha256 through unchanged (read-only backward compatibility)', () => {
		const entry = {
			version: '0.153.0',
			urlTemplate: URL_TEMPLATE,
			sha256: 'ab12cd34'.repeat(8),
		};
		process.env.AGENT_SDK_RESULTS_FILE = writeResults({ codex: entry });
		assert.deepStrictEqual(readAgentSdkResults().codex, entry);
	});

	test('fails loud when the results file is not a JSON object', () => {
		// NB: arrays are objects in JS — the guard rejects scalars AND arrays;
		// an array payload would fail downstream at the per-SDK entry access.
		process.env.AGENT_SDK_RESULTS_FILE = writeResults('not-an-object');
		assert.throws(() => readAgentSdkResults(), /not a JSON object/);
		process.env.AGENT_SDK_RESULTS_FILE = writeResults(['codex']);
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

suite('mergeAgentSdkResults (H1 per-target accumulation)', () => {

	test('accumulates per-target hashes across sequential produce runs', () => {
		const arm64: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const x64: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-x64': 'bb'.repeat(32) } } };
		assert.deepStrictEqual(mergeAgentSdkResults(arm64, x64), {
			codex: {
				version: '0.153.0',
				urlTemplate: URL_TEMPLATE,
				sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32), 'darwin-x64': 'bb'.repeat(32) },
			},
		});
	});

	test('re-running the same target overwrites that target only (idempotent self-merge)', () => {
		const first: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const rerun: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'cc'.repeat(32) } } };
		assert.deepStrictEqual(mergeAgentSdkResults(first, rerun), {
			codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'cc'.repeat(32) } },
		});
	});

	test('new SDK joins existing entries', () => {
		const existing: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const produced: IAgentSdkResults = { claude: { version: '1.2.3', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'dd'.repeat(32) } } };
		const merged = mergeAgentSdkResults(existing, produced);
		assert.deepStrictEqual(Object.keys(merged).sort(), ['claude', 'codex']);
		assert.deepStrictEqual(merged.codex, existing.codex);
	});

	test('version drift fails loud instead of mixing two SDK builds into one product.json', () => {
		const existing: IAgentSdkResults = { codex: { version: '0.152.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const produced: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-x64': 'bb'.repeat(32) } } };
		assert.throws(() => mergeAgentSdkResults(existing, produced), /refusing to mix versions/);
	});

	test('urlTemplate drift fails loud (distribution endpoint changed mid-sequence)', () => {
		const existing: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const produced: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: 'https://example.net/other-{sdkTarget}.tgz', sha256ByTarget: { 'darwin-x64': 'bb'.repeat(32) } } };
		assert.throws(() => mergeAgentSdkResults(existing, produced), /refusing to mix distribution endpoints/);
	});

	test('a legacy scalar sha256 in the existing file is dropped in favor of the per-target map', () => {
		const existing: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256: 'ee'.repeat(32) } };
		const produced: IAgentSdkResults = { codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } };
		const merged = mergeAgentSdkResults(existing, produced);
		assert.strictEqual(merged.codex.sha256, undefined, 'the scalar hash is valid for at most one target — it must not survive into a multi-target results file');
		assert.deepStrictEqual(merged.codex.sha256ByTarget, { 'darwin-arm64': 'aa'.repeat(32) });
	});
});

suite('readAgentSdkResultsFile', () => {
	test('reads an explicit path without consulting the environment', () => {
		const file = writeResults({ codex: { version: '0.153.0', urlTemplate: URL_TEMPLATE, sha256ByTarget: { 'darwin-arm64': 'aa'.repeat(32) } } });
		delete process.env.AGENT_SDK_RESULTS_FILE;
		assert.strictEqual(readAgentSdkResultsFile(file).codex.version, '0.153.0');
	});
});
