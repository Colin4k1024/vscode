/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ChatErrorLevel } from '../../../common/chatService/chatService.js';
import { ResponsePartKind, TurnState, type Turn } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { AgentHostSessionHandler } from '../../../browser/agentSessions/agentHost/agentHostSessionHandler.js';

/**
 * #31 review: a Codex server-overload turn error must render its own
 * localized message — the forwarded rate-limit meta alone would resolve to
 * Copilot-branded generic copy.
 */
suite('AgentHostSessionHandler - turn error details', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function createHandler(): AgentHostSessionHandler {
		const handler = Object.create(AgentHostSessionHandler.prototype) as AgentHostSessionHandler;
		(handler as unknown as { _chatEntitlementService: unknown })._chatEntitlementService = {
			entitlement: undefined,
			quotas: {},
		};
		return handler;
	}

	function turnWithError(errorType: string, message: string, meta?: Record<string, unknown>): Turn {
		return {
			state: TurnState.Error,
			responseParts: [{ kind: ResponsePartKind.Error, error: { errorType, message, ...(meta ? { _meta: meta } : {}) } }],
		} as unknown as Turn;
	}

	test('CodexServerOverloaded renders its own message (not the forwarded rate-limit copy)', () => {
		const handler = createHandler();
		const turn = turnWithError('CodexServerOverloaded', 'Codex is temporarily busy. Please try again shortly.', {
			chatError: { fetchError: { type: 'rateLimited' } },
		});
		const details = handler['_getTurnErrorDetails'](turn);
		assert.ok(details);
		assert.strictEqual(details.message, 'Codex is temporarily busy. Please try again shortly.');
		assert.strictEqual(details.level, ChatErrorLevel.Info);
	});

	test('executionInterrupted still renders its own message at warning level', () => {
		const handler = createHandler();
		const turn = turnWithError('executionInterrupted', 'interrupted by user');
		const details = handler['_getTurnErrorDetails'](turn);
		assert.ok(details);
		assert.strictEqual(details.message, 'interrupted by user');
		assert.strictEqual(details.level, ChatErrorLevel.Warning);
	});

	test('an ordinary turn error falls back to the generic presentation', () => {
		const handler = createHandler();
		const turn = turnWithError('CodexTurnError', 'boom');
		const details = handler['_getTurnErrorDetails'](turn);
		assert.ok(details);
		assert.match(details.message, /CodexTurnError/);
	});
});
