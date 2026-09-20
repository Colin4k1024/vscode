/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Meta-tests for the deterministic replay contract itself (acceptance items
 * AC2/AC3): an unrecorded model request must be a hard failure, and every
 * recorded response must be consumed before teardown. These tests
 * deliberately violate the contract against a scratch {@link CapiReplayProxy}
 * and assert the violation is surfaced as an error.
 *
 * Governance: the suite stays external to the agent host implementation —
 * these tests drive only the test-owned replay proxy over plain HTTP and
 * never import host internals.
 */

import assert from 'assert';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { join } from '../../../../../../base/common/path.js';
import { CapiReplayProxy } from '../harness/capiReplayProxy.js';
import { conformanceTest, type IAgentHostE2ETestContext } from './e2eTestContext.js';

// `http` is lazily required (not in this layer's import allowlist), mirroring
// `harness/capiReplayProxy.ts`.
const nodeRequire = createRequire(import.meta.url);
const httpModule = nodeRequire('http') as typeof import('http');

/** Shared empty fixture committed for host-only tests (resolved into `src/`, mirroring `harness/agentHostE2ETestHarness.ts`). */
const EMPTY_CAPTURE_PATH = fileURLToPath(new URL('../../../../../../../../src/vs/platform/agentHost/test/node/e2e/captures/empty.yaml', import.meta.url));

async function postToProxy(url: string, path: string, body: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = httpModule.request(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
			res.resume();
			res.on('end', () => resolve(res.statusCode ?? 0));
		});
		req.on('error', reject);
		req.end(body);
	});
}

export function defineReplayStrictnessTests(context: IAgentHostE2ETestContext): void {
	if (context.tier !== 'conformance') {
		return;
	}
	const { tempDirs } = context;

	conformanceTest(context, 'replay fails the run when a model request has no recorded response', async function () {
		const proxy = new CapiReplayProxy({ fixturePath: EMPTY_CAPTURE_PATH, mode: 'replay' });
		try {
			const url = await proxy.start();
			// The empty fixture records no model turn, so this is an unrecorded
			// request: the proxy must refuse it and report a hard cache miss.
			const status = await postToProxy(url, '/responses', '{}');
			assert.notStrictEqual(status, 200, 'an unrecorded model request must not be answered successfully');
			assert.throws(
				() => proxy.assertNoReplayMismatches(),
				/cache miss[\s\S]*POST \/responses/,
			);
		} finally {
			await proxy.close();
		}
	});

	conformanceTest(context, 'replay fails teardown when a recorded response is left unconsumed', async function () {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'ahp-strictness-'));
		tempDirs.push(fixtureDir);
		const fixturePath = join(fixtureDir, 'one-turn.yaml');
		writeFileSync(fixturePath, [
			'version: 1',
			'dialect: responses',
			'exchanges:',
			'  - request:',
			'      model: probe-model',
			'      messages:',
			'        - role: user',
			'          content: never asked',
			'    response:',
			'      content: never served',
			'      stopReason: end_turn',
			'',
		].join('\n'));

		// A provider that stops early never issues the recorded request; the
		// leftover exchange must fail the run rather than pass silently.
		const proxy = new CapiReplayProxy({ fixturePath, mode: 'replay' });
		assert.throws(
			() => proxy.assertNoReplayMismatches(),
			/unconsumed recorded responses[\s\S]*POST \/responses: 1 response\(s\)/,
		);
	});

	conformanceTest(context, 'replay refuses to start against a missing fixture', async function () {
		const fixtureDir = mkdtempSync(join(tmpdir(), 'ahp-strictness-'));
		tempDirs.push(fixtureDir);
		assert.throws(
			() => new CapiReplayProxy({ fixturePath: join(fixtureDir, 'missing.yaml'), mode: 'replay' }),
			/replay mode requires a fixture but none exists/,
		);
	});
}
