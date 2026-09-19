/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from '../../../../base/common/path.js';
import { fileURLToPath } from 'url';

/**
 * D11 (#13), governance principle 1: the Agent Host E2E suite is external to
 * the implementation. The only way it may obtain an implementation is
 * `IAgentHostTarget` (`harness/agentHostTarget.ts`) and the only way it may
 * talk to one is AHP over a WebSocket.
 *
 * This test keeps that rule executable: no file under `test/node/e2e/` may
 * import from the host's implementation layer (`src/vs/platform/agentHost/node/`),
 * and none may side-load the white-box mock agent. The `common/` imports the
 * suite relies on are protocol types and shared config keys — the contract the
 * suite asserts, not implementation internals.
 *
 * The check is textual on the import specifiers, which is exactly the boundary
 * that matters: an import of `node/…` is how implementation internals would
 * leak in, whatever form the surrounding code takes.
 */

// The test runs from `out/`, but the sources under audit live in `src/` —
// resolve up to the repository root and back down, the same way the E2E
// harness resolves its committed fixtures.
const e2eRoot = fileURLToPath(new URL('../../../../../../../../src/vs/platform/agentHost/test/node/e2e/', import.meta.url));

/** Matches a static import or require specifier that resolves into the host's `node/` implementation layer. */
const forbiddenImport = /(?:from\s+|require\()\s*'[^']*\/node\/[^']*'/;
/** The white-box side-loading flag from the frozen `../protocol/` suite; never valid in the external suite. */
const forbiddenMockAgentFlag = '--enable-mock-agent';

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			files.push(...collectSourceFiles(path));
		} else if (/\.(ts|mts)$/.test(entry)) {
			files.push(path);
		}
	}
	return files;
}

suite('Agent Host E2E externality (governance principle 1)', () => {

	test('e2e sources do not import host implementation modules', () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(e2eRoot)) {
			const source = readFileSync(file, 'utf8');
			for (const line of source.split(/\r?\n/)) {
				if (forbiddenImport.test(line)) {
					offenders.push(`${file}: ${line.trim()}`);
				}
			}
		}
		assert.deepStrictEqual(offenders, [], [
			'Files under test/node/e2e must not import from src/vs/platform/agentHost/node/ —',
			'the suite is external to the implementation and may only reach it through',
			'IAgentHostTarget (harness/agentHostTarget.ts) and the AHP protocol.',
			'Offenders:',
			...offenders,
		].join('\n'));
	});

	test('e2e sources do not side-load the mock agent', () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(e2eRoot)) {
			const source = readFileSync(file, 'utf8');
			if (source.includes(forbiddenMockAgentFlag)) {
				offenders.push(file);
			}
		}
		assert.deepStrictEqual(offenders, [], [
			'Files under test/node/e2e must not use --enable-mock-agent:',
			...offenders,
		].join('\n'));
	});
});
