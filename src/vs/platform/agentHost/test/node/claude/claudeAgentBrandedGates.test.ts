/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { NullLogService } from '../../../../log/common/log.js';
import type { IProductService } from '../../../../product/common/productService.js';
import { copilotApiShipped } from '../../../node/shared/copilotApiService.js';
import { ClaudeAgent } from '../../../node/claude/claudeAgent.js';
import type { IAgentHostGitHubEndpointService } from '../../../node/agentHostGitHubEndpointService.js';
import type { ProtectedResourceMetadata } from '../../../common/state/protocol/state.js';

/**
 * PR #71 review: the branded build (D10 section 5 — `excludeCopilotFromPackaging`)
 * gates Claude's Copilot surface exactly like CodexAgent's. The gates are
 * one-line checks on the shared {@link copilotApiShipped} predicate; these
 * tests pin both the predicate and the two Claude entry points via a
 * plain-object harness (the same pattern codexProxyGating.test.ts uses for
 * `_startRawConnection`) so no DI container is needed. suite/test are the
 * mocha TDD globals (no import — importing node:test would shadow them and
 * detach the suites from the project runner).
 */

const COPILOT_RESOURCE: ProtectedResourceMetadata = {
	resource: 'https://example.test/copilot',
	scopes_supported: [],
} as ProtectedResourceMetadata;
const REPO_RESOURCE: ProtectedResourceMetadata = {
	resource: 'https://example.test/repo',
	scopes_supported: [],
} as ProtectedResourceMetadata;

const fakeGitHubEndpoints = {
	getCopilotResource: () => COPILOT_RESOURCE,
	getRepoResource: () => REPO_RESOURCE,
} as unknown as IAgentHostGitHubEndpointService;

const BRANDED = { excludeCopilotFromPackaging: true } as IProductService;
const DEV = { excludeCopilotFromPackaging: false } as unknown as IProductService;

function harness(productService: IProductService | undefined) {
	return {
		_gitHubEndpointService: fakeGitHubEndpoints,
		_productService: productService,
		_logService: new NullLogService(),
	};
}

suite('copilotApiShipped (shared branded-build predicate, PR #71)', () => {
	test('true when the product service is absent or the flag is not set', () => {
		assert.strictEqual(copilotApiShipped(undefined), true);
		assert.strictEqual(copilotApiShipped(DEV), true);
	});

	test('false only when the mixin sets excludeCopilotFromPackaging', () => {
		assert.strictEqual(copilotApiShipped(BRANDED), false);
	});
});

suite('ClaudeAgent branded-build Copilot gates (issue #66 M3, PR #71)', () => {
	test('getProtectedResources omits the Copilot resource in the branded build', () => {
		const resources = ClaudeAgent.prototype.getProtectedResources.call(harness(BRANDED) as unknown as ClaudeAgent);
		assert.deepStrictEqual(resources.map(r => r.resource), [REPO_RESOURCE.resource]);
		assert.strictEqual(resources[0].required, false, 'the repo resource must stay optional (signed-out window gate)');
	});

	test('getProtectedResources lists both resources in a dev build', () => {
		const resources = ClaudeAgent.prototype.getProtectedResources.call(harness(DEV) as unknown as ClaudeAgent);
		assert.ok(resources.some(r => r.resource === COPILOT_RESOURCE.resource));
		assert.ok(resources.some(r => r.resource === REPO_RESOURCE.resource));
	});

	test('authenticate accept-and-ignores a Copilot token in the branded build', async () => {
		const accepted = await ClaudeAgent.prototype.authenticate.call(harness(BRANDED) as unknown as ClaudeAgent, COPILOT_RESOURCE.resource, 'gho_stale');
		assert.strictEqual(accepted, true, 'a stale/dev-profile Copilot token is accepted-and-ignored, not rejected');
	});

	test('authenticate still rejects unknown resources in the branded build', async () => {
		const accepted = await ClaudeAgent.prototype.authenticate.call(harness(BRANDED) as unknown as ClaudeAgent, 'https://example.test/other', 'x');
		assert.strictEqual(accepted, false);
	});
});
