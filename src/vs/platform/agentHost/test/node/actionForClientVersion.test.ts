/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License.
 *  See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ActionType, type ActionEnvelope } from '../../common/state/protocol/common/actions.js';
import { ACTION_INTRODUCED_IN, PROTOCOL_VERSION } from '../../common/state/protocol/version/registry.js';
import { actionForClientVersion } from '../../node/protocolServerHandler.js';

suite('actionForClientVersion', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const envelope: ActionEnvelope = {
		channel: URI.parse('file:///chat').toString(),
		action: {
			type: ActionType.ChatTurnUncertain,
			turnId: 'turn-1',
			duration: 42,
			part: { kind: 'error', error: { errorType: 'unknown', message: 'outcome unknown' } } as never,
		},
		serverSeq: 7,
		origin: undefined,
	};

	test('known action passes through unchanged', () => {
		assert.strictEqual(actionForClientVersion(envelope, PROTOCOL_VERSION), envelope);
	});

	test('turnUncertain degrades to chat/error for a client that predates it', () => {
		const gated = actionForClientVersion(envelope, '0.9.0');
		assert.ok(gated !== undefined);
		assert.strictEqual(gated.action.type, ActionType.ChatError);
		assert.strictEqual((gated.action as { turnId: string }).turnId, 'turn-1');
		assert.strictEqual((gated.action as { duration: number }).duration, 42);
	});

	test('other unknown actions drop', () => {
		// AutomationRunPrimarySessionChanged is 0.8.0+; a client at 0.7.0 does not
		// know it and should get nothing back.
		const envelope2: ActionEnvelope = {
			...envelope,
			action: {
				type: ActionType.AutomationRunPrimarySessionChanged,
				automationRunId: 'r1',
				primarySessionId: null,
			} as never,
		};
		assert.strictEqual(actionForClientVersion(envelope2, '0.7.0'), undefined);
	});

	test('max known action version never exceeds the protocol version', () => {
		const max = Math.max(...Object.values(ACTION_INTRODUCED_IN).map(v => v.split('.').map(Number).reduce((a, b, i) => a * 1000 + (b ?? 0), 0)));
		const cur = PROTOCOL_VERSION.split('.').map(Number).reduce((a, b, i) => a * 1000 + (b ?? 0), 0);
		assert.ok(max <= cur, `an action introduced after PROTOCOL_VERSION (${PROTOCOL_VERSION}) would be dropped for every client`);
	});
});
