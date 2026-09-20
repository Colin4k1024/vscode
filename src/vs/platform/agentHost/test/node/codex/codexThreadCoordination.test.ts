/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentSession, CODEX_AGENT_PROVIDER_ID } from '../../../common/agentService.js';
import { buildOpenSessionLinkUri } from '../../../common/openSessionLink.js';
import { SessionServerToolName } from '../../../common/serverToolNames.js';
import {
	buildCodexThreadOpenLink,
	extractCodexCreatedThreadDirectives,
	getCodexRolloutThreadCoordinationCall,
	getCodexThreadCoordinationCall,
} from '../../../node/codex/codexThreadCoordination.js';
import type { ThreadItem } from '../../../node/codex/protocol/generated/v2/ThreadItem.js';

type DynamicToolCallItem = Extract<ThreadItem, { type: 'dynamicToolCall' }>;

function toolCallItem(overrides: Partial<DynamicToolCallItem>): DynamicToolCallItem {
	return {
		type: 'dynamicToolCall',
		id: 'item-1',
		namespace: 'codex_app',
		tool: 'create_thread',
		arguments: {},
		status: 'completed',
		contentItems: null,
		success: true,
		durationMs: null,
		...overrides,
	} as DynamicToolCallItem;
}

function jsonOutput(value: object): DynamicToolCallItem['contentItems'] {
	return [{ type: 'inputText', text: JSON.stringify(value) }];
}

suite('codexThreadCoordination', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('buildCodexThreadOpenLink', () => {
		test('matches the canonical open-session link for the Codex provider', () => {
			const expected = buildOpenSessionLinkUri(AgentSession.uri(CODEX_AGENT_PROVIDER_ID, 'thr_123'));
			assert.strictEqual(buildCodexThreadOpenLink('thr_123'), expected);
		});
	});

	suite('getCodexThreadCoordinationCall', () => {
		test('recognizes a completed local create_thread call', () => {
			const args = { prompt: 'do the thing' };
			const call = getCodexThreadCoordinationCall(toolCallItem({
				arguments: args,
				contentItems: jsonOutput({ threadId: 'thr_abc', hostId: 'local' }),
			}));
			assert.ok(call);
			assert.strictEqual(call.toolName, SessionServerToolName.CreateSession);
			assert.strictEqual(call.targetThreadId, 'thr_abc');
			assert.strictEqual(call.openLink, buildCodexThreadOpenLink('thr_abc'));
			assert.deepStrictEqual(call.toolInput, args);
		});

		test('falls back to clientThreadId while worktree setup is pending', () => {
			const call = getCodexThreadCoordinationCall(toolCallItem({
				contentItems: jsonOutput({ clientThreadId: 'client-9' }),
			}));
			assert.ok(call);
			assert.strictEqual(call.targetThreadId, 'client-9');
		});

		test('ignores calls attributed to a remote host', () => {
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({
				contentItems: jsonOutput({ threadId: 'thr_remote', hostId: 'darwin-2' }),
			})), undefined);
		});

		test('ignores failed, incomplete, foreign-namespace, and unknown-tool items', () => {
			const base = { contentItems: jsonOutput({ threadId: 'thr_x' }) };
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ ...base, success: false })), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ ...base, status: 'inProgress' })), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ ...base, namespace: 'other_app' })), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ ...base, namespace: null })), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ ...base, tool: 'list_threads' })), undefined);
		});

		test('ignores items whose result carries no thread identity', () => {
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({
				contentItems: jsonOutput({ status: 'ok' }),
			})), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({ contentItems: null })), undefined);
		});

		test('recognizes send_message_to_thread addressed to a local thread', () => {
			const args = { threadId: 'thr_target', prompt: 'follow up' };
			const call = getCodexThreadCoordinationCall(toolCallItem({
				tool: 'send_message_to_thread',
				arguments: args,
				contentItems: null,
			}));
			assert.ok(call);
			assert.strictEqual(call.toolName, SessionServerToolName.SendMessage);
			assert.strictEqual(call.targetThreadId, 'thr_target');
			assert.deepStrictEqual(call.toolInput, args);
		});

		test('ignores send_message_to_thread addressed to a remote host or no thread', () => {
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({
				tool: 'send_message_to_thread',
				arguments: { threadId: 'thr_target', hostId: 'darwin-2' },
			})), undefined);
			assert.strictEqual(getCodexThreadCoordinationCall(toolCallItem({
				tool: 'send_message_to_thread',
				arguments: { prompt: 'nowhere' },
			})), undefined);
		});

		test('recovers a result that trails human-readable status text', () => {
			const call = getCodexThreadCoordinationCall(toolCallItem({
				contentItems: [{ type: 'inputText', text: 'Creating thread...\n' + JSON.stringify({ threadId: 'thr_tail' }) }],
			}));
			assert.ok(call);
			assert.strictEqual(call.targetThreadId, 'thr_tail');
		});
	});

	suite('getCodexRolloutThreadCoordinationCall', () => {
		const createInput = 'tools.codex_app__create_thread({title: "Investigate flake", prompt: "look at it"})';
		const sendInput = 'tools.codex_app__send_message_to_thread({threadId: "thr_1", prompt: "ping"})';

		test('recovers a create_thread call from its persisted invocation and output', () => {
			const call = getCodexRolloutThreadCoordinationCall(createInput, ['done\n' + JSON.stringify({ threadId: 'thr_1' })]);
			assert.ok(call);
			assert.strictEqual(call.toolName, SessionServerToolName.CreateSession);
			assert.strictEqual(call.targetThreadId, 'thr_1');
			assert.deepStrictEqual(call.toolInput, { prompt: 'Investigate flake' });
		});

		test('recovers a send_message_to_thread call with its prompt as the label', () => {
			const call = getCodexRolloutThreadCoordinationCall(sendInput, [JSON.stringify({ threadId: 'thr_1' })]);
			assert.ok(call);
			assert.strictEqual(call.toolName, SessionServerToolName.SendMessage);
			assert.deepStrictEqual(call.toolInput, { prompt: 'ping' });
		});

		test('falls back to the raw thread id when no label can be recovered', () => {
			const call = getCodexRolloutThreadCoordinationCall('tools.codex_app__create_thread({})', [JSON.stringify({ threadId: 'thr_bare' })]);
			assert.ok(call);
			assert.deepStrictEqual(call.toolInput, { prompt: 'thr_bare' });
		});

		test('ignores remote-host outcomes and identity-less output', () => {
			assert.strictEqual(getCodexRolloutThreadCoordinationCall(createInput, [JSON.stringify({ threadId: 'thr_1', hostId: 'darwin-2' })]), undefined);
			assert.strictEqual(getCodexRolloutThreadCoordinationCall(createInput, ['no json here']), undefined);
			assert.strictEqual(getCodexRolloutThreadCoordinationCall('tools.codex_app__list_threads({})', [JSON.stringify({ threadId: 'thr_1' })]), undefined);
		});

		test('honors a clientThreadId-only pending result', () => {
			const call = getCodexRolloutThreadCoordinationCall(createInput, [JSON.stringify({ clientThreadId: 'client-7' })]);
			assert.ok(call);
			assert.strictEqual(call.targetThreadId, 'client-7');
		});
	});

	suite('extractCodexCreatedThreadDirectives', () => {
		test('extracts a bare directive and removes its line', () => {
			const result = extractCodexCreatedThreadDirectives('Created the thread.\n::created-thread{threadId="thr_1"}');
			assert.deepStrictEqual(result.threadIds, ['thr_1']);
			assert.strictEqual(result.text, 'Created the thread.');
		});

		test('accepts the clientThreadId variant', () => {
			const result = extractCodexCreatedThreadDirectives('::created-thread{clientThreadId="client-1"}');
			assert.deepStrictEqual(result.threadIds, ['client-1']);
			assert.strictEqual(result.text, '');
		});

		test('returns the original text untouched when no directive is present', () => {
			const text = 'No directives here.\nSecond line.';
			const result = extractCodexCreatedThreadDirectives(text);
			assert.deepStrictEqual(result.threadIds, []);
			assert.strictEqual(result.text, text);
		});

		test('preserves directives inside fenced code blocks', () => {
			const text = 'Example:\n```\n::created-thread{threadId="thr_example"}\n```\n::created-thread{threadId="thr_real"}';
			const result = extractCodexCreatedThreadDirectives(text);
			assert.deepStrictEqual(result.threadIds, ['thr_real']);
			assert.ok(result.text.includes('::created-thread{threadId="thr_example"}'), 'fenced example must survive');
			assert.ok(!result.text.includes('thr_real'), 'bare directive line must be removed');
		});

		test('a fence only closes on the same marker of at least the opening length', () => {
			const text = '````\n::created-thread{threadId="thr_fenced"}\n```\n::created-thread{threadId="thr_still_fenced"}\n````\n::created-thread{threadId="thr_free"}';
			const result = extractCodexCreatedThreadDirectives(text);
			assert.deepStrictEqual(result.threadIds, ['thr_free']);
		});

		test('collapses the blank line pair left behind by a removed directive', () => {
			const result = extractCodexCreatedThreadDirectives('Before.\n\n::created-thread{threadId="thr_1"}\n\nAfter.');
			assert.deepStrictEqual(result.threadIds, ['thr_1']);
			assert.strictEqual(result.text, 'Before.\n\nAfter.');
		});

		test('collects multiple directives in order', () => {
			const result = extractCodexCreatedThreadDirectives('::created-thread{threadId="a"}\ntext\n::created-thread{threadId="b"}');
			assert.deepStrictEqual(result.threadIds, ['a', 'b']);
			assert.strictEqual(result.text, 'text');
		});
	});
});
