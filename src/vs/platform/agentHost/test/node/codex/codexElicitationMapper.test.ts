/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatInputRequestPurpose } from '../../../common/meta/agentChatInputRequestMeta.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, type ChatInputAnswer } from '../../../common/state/sessionState.js';
import { buildElicitationRequest, elicitationResponseFromAnswers } from '../../../node/codex/codexElicitationMapper.js';
import type { McpServerElicitationRequestParams } from '../../../node/codex/protocol/generated/v2/McpServerElicitationRequestParams.js';

suite('codexElicitationMapper', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const formParams: McpServerElicitationRequestParams = {
		threadId: 't1', turnId: null, serverName: 'srv', mode: 'form', _meta: null,
		message: 'Please configure',
		requestedSchema: {
			type: 'object',
			required: ['name', 'count'],
			properties: {
				name: { type: 'string', title: 'Name', description: 'Your name', minLength: 1 },
				count: { type: 'integer', title: 'Count', minimum: 0, maximum: 9 },
				enabled: { type: 'boolean', title: 'Enabled', default: true },
				color: { type: 'string', title: 'Color', enum: ['red', 'green'], enumNames: ['Red', 'Green'] },
				size: { type: 'string', title: 'Size', oneOf: [{ const: 's', title: 'Small' }, { const: 'l', title: 'Large' }] },
				tags: { type: 'array', title: 'Tags', items: { type: 'string', enum: ['a', 'b'] } },
			},
		},
	};

	const urlParams: McpServerElicitationRequestParams = {
		threadId: 't1', turnId: null, serverName: 'srv', mode: 'url', _meta: null,
		message: 'Authorize', url: 'https://example.com/auth', elicitationId: 'e1',
	};

	// B17 (acceptance-core): a mode whose input semantics we cannot project —
	// `openai/form` carries an opaque OpenAI-specific schema.
	const unknownModeParams: McpServerElicitationRequestParams = {
		threadId: 't1', turnId: null, serverName: 'srv', mode: 'openai/form', _meta: null,
		message: 'Provide opaque values',
		requestedSchema: { type: 'object', required: ['opaque'], properties: { opaque: { type: 'string', title: 'Opaque' } } },
	};

	test('buildElicitationRequest (form) projects every primitive field kind', () => {
		assert.deepStrictEqual(buildElicitationRequest('req-1', formParams), {
			id: 'req-1',
			_meta: { purpose: ChatInputRequestPurpose.Elicitation },
			message: 'Please configure',
			questions: [
				{ kind: ChatInputQuestionKind.Text, id: 'name', title: 'Name', message: 'Your name', required: true, format: undefined, min: 1, max: undefined, defaultValue: undefined },
				{ kind: ChatInputQuestionKind.Integer, id: 'count', title: 'Count', message: 'Count', required: true, min: 0, max: 9, defaultValue: undefined },
				{ kind: ChatInputQuestionKind.Boolean, id: 'enabled', title: 'Enabled', message: 'Enabled', required: false, defaultValue: true },
				{ kind: ChatInputQuestionKind.SingleSelect, id: 'color', title: 'Color', message: 'Color', required: false, options: [{ id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }] },
				{ kind: ChatInputQuestionKind.SingleSelect, id: 'size', title: 'Size', message: 'Size', required: false, options: [{ id: 's', label: 'Small' }, { id: 'l', label: 'Large' }] },
				{ kind: ChatInputQuestionKind.MultiSelect, id: 'tags', title: 'Tags', message: 'Tags', required: false, options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], min: undefined, max: undefined },
			],
		});
	});

	test('buildElicitationRequest (url) surfaces the url with no questions', () => {
		assert.deepStrictEqual(buildElicitationRequest('req-2', urlParams), {
			id: 'req-2', _meta: { purpose: ChatInputRequestPurpose.Elicitation }, message: 'Authorize', url: 'https://example.com/auth',
		});
	});

	test('buildElicitationRequest (unknown mode) surfaces the message only, never a half-rendered form', () => {
		// B17: `openai/form` (or any mode that is not `form`/`url`) cannot be
		// projected into typed questions. The request must stay message-only so
		// the user can still accept or decline — no partial form, no error.
		const request = buildElicitationRequest('req-3', unknownModeParams);
		assert.deepStrictEqual(request, {
			id: 'req-3',
			_meta: { purpose: ChatInputRequestPurpose.Elicitation },
			message: 'Provide opaque values',
		});
		assert.strictEqual(request.questions, undefined, 'an unprojectable mode must not render partial questions');
	});

	test('elicitationResponseFromAnswers (unknown mode) waits for the user: decline and cancel map to MCP actions', () => {
		// B17: the host must answer the MCP server with the user's choice —
		// decline/cancel — and never with a JSON-RPC error.
		assert.deepStrictEqual({
			decline: elicitationResponseFromAnswers(unknownModeParams, ChatInputResponseKind.Decline, undefined),
			cancel: elicitationResponseFromAnswers(unknownModeParams, ChatInputResponseKind.Cancel, undefined),
		}, {
			decline: { action: 'decline', content: null, _meta: null },
			cancel: { action: 'cancel', content: null, _meta: null },
		});
	});

	test('elicitationResponseFromAnswers maps decline/cancel/accept', () => {
		const accepted: Record<string, ChatInputAnswer> = {
			name: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.Text, value: 'Ada' } },
			count: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.Number, value: 3 } },
			enabled: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.Boolean, value: false } },
			color: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.Selected, value: 'red' } },
			tags: { state: ChatInputAnswerState.Submitted, value: { kind: ChatInputAnswerValueKind.SelectedMany, value: ['a', 'b'] } },
			size: { state: ChatInputAnswerState.Skipped },
		};
		assert.deepStrictEqual({
			decline: elicitationResponseFromAnswers(formParams, ChatInputResponseKind.Decline, undefined),
			cancel: elicitationResponseFromAnswers(formParams, ChatInputResponseKind.Cancel, undefined),
			accept: elicitationResponseFromAnswers(formParams, ChatInputResponseKind.Accept, accepted),
		}, {
			decline: { action: 'decline', content: null, _meta: null },
			cancel: { action: 'cancel', content: null, _meta: null },
			accept: { action: 'accept', _meta: null, content: { name: 'Ada', count: 3, enabled: false, color: 'red', tags: ['a', 'b'] } },
		});
	});

	test('elicitationResponseFromAnswers (url accept) carries no content', () => {
		assert.deepStrictEqual(
			elicitationResponseFromAnswers(urlParams, ChatInputResponseKind.Accept, undefined),
			{ action: 'accept', content: null, _meta: null },
		);
	});
});
