/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PassThrough } from 'stream';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CodexAppServerClient, type ICodexAppServerTransport } from '../../../node/codex/codexAppServerClient.js';
import { createCodexSessionMapState, mapItemCompleted, mapItemStarted, mapTurnCompleted, mapTurnStarted, type ICodexSessionMapState } from '../../../node/codex/codexMapAppServerEvents.js';
import type { ItemCompletedNotification } from '../../../node/codex/protocol/generated/v2/ItemCompletedNotification.js';
import type { ItemStartedNotification } from '../../../node/codex/protocol/generated/v2/ItemStartedNotification.js';
import type { TurnCompletedNotification } from '../../../node/codex/protocol/generated/v2/TurnCompletedNotification.js';
import type { TurnStartedNotification } from '../../../node/codex/protocol/generated/v2/TurnStartedNotification.js';
import { ActionType, type ChatAction, type SessionAction } from '../../../common/state/sessionActions.js';
import { chatReducer } from '../../../common/state/protocol/reducers.js';
import { ChatOriginKind, MessageKind, ResponsePartKind, SessionStatus, ToolCallStatus, TurnState, type ChatState, type ToolCallResponsePart } from '../../../common/state/sessionState.js';

/**
 * D12 / Issue #14 — A1 turn-lifecycle invariants (state machine guards).
 *
 * Two layers are exercised together:
 *  - the Codex app-server event mapper (`codexMapAppServerEvents.ts`), which is
 *    the producer of AHP chat actions, and
 *  - the protocol `chatReducer`, which is the consumer that owns the turn state
 *    machine (`activeTurn` scalar ⇒ at most one active turn; terminal turns are
 *    immutable because every non-terminal action requires a matching activeTurn).
 *
 * The reducer is what makes `completed → active` impossible: once `endTurn`
 * moves the turn into `turns[]` and clears `activeTurn`, every later action for
 * that turn id is a no-op. These tests pin that contract down exhaustively.
 */

// ---- Fixture builders --------------------------------------------------------

function turnStartedParams(turnId: string, text = 'do a thing'): TurnStartedNotification {
	return {
		threadId: 'thr_1',
		turn: {
			id: turnId,
			items: [{
				type: 'userMessage',
				id: `${turnId}_user`,
				clientId: null,
				content: [{ type: 'text', text, text_elements: [] }],
			}],
			itemsView: { type: 'full' } as never,
			status: 'inProgress' as never,
			error: null,
			startedAt: null,
			completedAt: null,
			durationMs: null,
		},
	} as TurnStartedNotification;
}

function commandStartedParams(itemId: string, turnId: string, command = 'ls'): ItemStartedNotification {
	return {
		item: {
			type: 'commandExecution', id: itemId,
			command, cwd: '/tmp', processId: null,
			source: 'agent' as never, status: 'inProgress' as never,
			commandActions: [], aggregatedOutput: null,
			exitCode: null, durationMs: null,
		} as never,
		threadId: 'thr_1', turnId, startedAtMs: 0,
	} as ItemStartedNotification;
}

function commandCompletedParams(itemId: string, turnId: string, options: { readonly status?: string; readonly exitCode?: number | null; readonly output?: string } = {}): ItemCompletedNotification {
	const { status = 'completed', exitCode = 0, output = 'done' } = options;
	return {
		item: {
			type: 'commandExecution', id: itemId,
			command: 'ls', cwd: '/tmp', processId: null,
			source: 'agent' as never, status: status as never,
			commandActions: [], aggregatedOutput: output,
			exitCode, durationMs: 5,
		} as never,
		threadId: 'thr_1', turnId, completedAtMs: 5,
	} as ItemCompletedNotification;
}

function agentMessageStartedParams(itemId: string, turnId: string): ItemStartedNotification {
	return {
		item: { type: 'agentMessage', id: itemId, text: '', phase: null, memoryCitation: null } as never,
		threadId: 'thr_1', turnId, startedAtMs: 0,
	} as ItemStartedNotification;
}

function turnCompletedParams(turnId: string, status: 'completed' | 'failed' | 'interrupted'): TurnCompletedNotification {
	return {
		threadId: 'thr_1',
		turn: {
			id: turnId,
			items: [],
			itemsView: { type: 'notLoaded' } as never,
			status: status as never,
			error: status === 'failed' ? { message: 'boom', additionalDetails: null, codexErrorInfo: null } as never : null,
			startedAt: null,
			completedAt: null,
			durationMs: 10,
		},
	} as TurnCompletedNotification;
}

/**
 * `TurnState` is a terminal-only enum (`Complete` / `Cancelled` / `Error`) — a
 * turn still in flight is represented by `activeTurn`, never by an entry in
 * `turns[]`. Pin the full terminal set so "no non-terminal turn" assertions
 * compare against real values (a mistyped member such as `TurnState.InProgress`
 * would compile to `undefined` and make the assertion vacuous).
 */
const TERMINAL_TURN_STATES: readonly TurnState[] = [TurnState.Complete, TurnState.Cancelled, TurnState.Error];

/**
 * Non-terminal `ToolCallStatus` values. Terminal statuses are `Completed` and
 * `Cancelled`; everything else means the tool call is still open and must be
 * force-finalized when its turn ends. (There is no `ToolCallStatus.InProgress`
 * member — asserting against it would be vacuous.)
 */
const NON_TERMINAL_TOOL_STATUSES: readonly ToolCallStatus[] = [
	ToolCallStatus.Streaming,
	ToolCallStatus.PendingConfirmation,
	ToolCallStatus.Running,
	ToolCallStatus.AuthRequired,
	ToolCallStatus.PendingResultConfirmation,
];

// ---- Harness: mapper → reducer ----------------------------------------------

function makeChatState(): ChatState {
	return {
		resource: 'ahp-chat://default/test',
		title: 'Test',
		status: SessionStatus.Idle,
		modifiedAt: new Date(0).toISOString(),
		origin: { kind: ChatOriginKind.User },
		turns: [],
		activeTurn: undefined,
	};
}

interface IFeedResult {
	readonly actions: readonly (SessionAction | ChatAction)[];
	readonly state: ChatState;
}

class TurnHarness {
	readonly mapState: ICodexSessionMapState = createCodexSessionMapState();
	chat: ChatState = makeChatState();
	readonly allActions: (SessionAction | ChatAction)[] = [];

	feed(actions: readonly (SessionAction | ChatAction)[]): IFeedResult {
		this.allActions.push(...actions);
		for (const action of actions) {
			if (typeof (action as { turnId?: unknown }).turnId === 'string') {
				this.chat = chatReducer(this.chat, action as ChatAction);
			}
		}
		return { actions, state: this.chat };
	}

	turnStarted(turnId: string): IFeedResult {
		return this.feed(mapTurnStarted(this.mapState, turnStartedParams(turnId), 'fallback'));
	}

	itemStarted(params: ItemStartedNotification): IFeedResult {
		return this.feed(mapItemStarted(this.mapState, params));
	}

	itemCompleted(params: ItemCompletedNotification): IFeedResult {
		return this.feed(mapItemCompleted(this.mapState, params));
	}

	turnCompleted(turnId: string, status: 'completed' | 'failed' | 'interrupted'): IFeedResult {
		return this.feed(mapTurnCompleted(this.mapState, turnCompletedParams(turnId, status)));
	}
}

function terminalActionTypes(actions: readonly (SessionAction | ChatAction)[]): ActionType[] {
	return actions.filter(a => a.type === ActionType.ChatTurnComplete || a.type === ActionType.ChatTurnCancelled).map(a => a.type);
}

/** Every chat action carries a turnId; the lifecycle actions for one turn. */
function actionsForTurn(actions: readonly (SessionAction | ChatAction)[], turnId: string): (SessionAction | ChatAction)[] {
	return actions.filter(a => (a as { turnId?: string }).turnId === turnId);
}

// ---- Fake app-server transport (client-level invariants) ---------------------

interface IFakePeer {
	readonly transport: ICodexAppServerTransport;
	readonly outbound: PassThrough;
	push(message: object): void;
	dispose(): void;
}

function makeFakePeer(): IFakePeer {
	const clientStdin = new PassThrough();
	const clientStdout = new PassThrough();
	const exitEmitter = new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();
	const transport: ICodexAppServerTransport = {
		stdin: clientStdin,
		stdout: clientStdout,
		kill() { return true; },
		onExit: exitEmitter.event,
		onExitOnce() { /* noop */ },
	};
	return {
		transport,
		outbound: clientStdin,
		push(message: object) {
			clientStdout.write(JSON.stringify(message) + '\n');
		},
		dispose() {
			exitEmitter.dispose();
			clientStdin.destroy();
			clientStdout.destroy();
		},
	};
}

function readNextMessage(stream: PassThrough, timeoutMs = 1_000): Promise<{ id?: number; method?: string; result?: unknown; error?: unknown }> {
	return new Promise((resolve, reject) => {
		let buf = '';
		const onData = (chunk: Buffer | string) => {
			buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			const nl = buf.indexOf('\n');
			if (nl < 0) {
				return;
			}
			cleanup();
			resolve(JSON.parse(buf.slice(0, nl).trim()));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error('timed out waiting for wire message'));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timer);
			stream.off('data', onData);
		};
		stream.on('data', onData);
	});
}

suite('codexTurnLifecycleInvariants (D12 / A1)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// -- A1.1: turn/start response ≠ running; only turn/started starts the turn --

	suite('A1.1 response-is-not-start', () => {

		test('a turn/start result resolves the request without producing any turn/started notification', async () => {
			const peer = makeFakePeer();
			const client = new CodexAppServerClient(peer.transport);
			try {
				let turnStartedFired = false;
				const handle = client.onNotification('turn/started', () => { turnStartedFired = true; });

				const responsePromise = client.request<'turn/start'>('turn/start', { threadId: 'thr_1', input: [] });
				const sent = await readNextMessage(peer.outbound);
				peer.push({ id: sent.id, result: { turn: { id: 'turn_a', status: 'inProgress' } } });
				await responsePromise;
				await new Promise(r => setImmediate(r));

				// The accepted response carries the assigned turn id but the turn is
				// NOT running from the client's perspective until the notification.
				assert.strictEqual(turnStartedFired, false, 'turn/start result must not be treated as turn/started');

				peer.push({ method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_a', status: 'inProgress' } } });
				await new Promise(r => setImmediate(r));
				assert.strictEqual(turnStartedFired, true, 'turn/started notification is the real run start');
				handle.dispose();
			} finally {
				client.dispose();
				peer.dispose();
			}
		});

		test('the mapper has no producer for a turn/start *response* — only mapTurnStarted emits ChatTurnStarted', () => {
			// Feeding item activity without turn/started must not open a turn at the
			// reducer level: ChatToolCallStart/ChatResponsePart require an activeTurn
			// with a matching id, so a response-shaped "turn exists" fact cannot leak
			// into the running state.
			const harness = new TurnHarness();
			harness.itemStarted(commandStartedParams('cmd_orphan', 'turn_never_started'));
			assert.strictEqual(harness.chat.activeTurn, undefined, 'no active turn without ChatTurnStarted');
			assert.strictEqual(harness.chat.turns.length, 0);
		});
	});

	// -- A1.2: at most one active turn per thread -------------------------------

	suite('A1.2 single-active-turn', () => {

		test('a second turn/start rejected by the app-server surfaces as a request error, never as a second active turn', async () => {
			const peer = makeFakePeer();
			const client = new CodexAppServerClient(peer.transport);
			try {
				const startedTurns: string[] = [];
				const handle = client.onNotification('turn/started', params => startedTurns.push((params as { turn: { id: string } }).turn.id));

				const first = client.request<'turn/start'>('turn/start', { threadId: 'thr_1', input: [] });
				const firstSent = await readNextMessage(peer.outbound);
				peer.push({ id: firstSent.id, result: { turn: { id: 'turn_a', status: 'inProgress' } } });
				await first;

				// A concurrent second turn/start on the same thread is rejected.
				const second = client.request<'turn/start'>('turn/start', { threadId: 'thr_1', input: [] });
				const secondSent = await readNextMessage(peer.outbound);
				peer.push({ id: secondSent.id, error: { code: -32000, message: 'thread already has an active turn' } });
				await assert.rejects(second);

				peer.push({ method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_a', status: 'inProgress' } } });
				await new Promise(r => setImmediate(r));
				assert.deepStrictEqual(startedTurns, ['turn_a'], 'exactly one turn ever started');
				handle.dispose();
			} finally {
				client.dispose();
				peer.dispose();
			}
		});

		test('reducer keeps at most one activeTurn even if a duplicate ChatTurnStarted slips through', () => {
			// The "at most one" invariant is enforced upstream (the orchestrator
			// serializes sends per chat and the app-server rejects concurrent
			// turn/start). The reducer is the last line of defence: activeTurn is a
			// scalar, so a duplicate start REPLACES rather than stacks — the state
			// can never hold two active turns.
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.turnStarted('turn_b');
			assert.strictEqual(harness.chat.activeTurn?.id, 'turn_b');
			// A turn still in flight is `activeTurn`; `turns[]` only ever holds
			// finalized turns. Assert that positively against the real terminal
			// set (TurnState has no `InProgress` member — comparing against it
			// would be vacuous) and that no finalized turn shares identity with
			// the active one.
			assert.ok(harness.chat.turns.every(t => TERMINAL_TURN_STATES.includes(t.state)), 'finalized turns only ever carry a terminal state');
			assert.ok(!harness.chat.turns.some(t => t.id === harness.chat.activeTurn?.id), 'no finalized turn can share identity with the active turn');
		});
	});

	// -- A1.3: terminal events are never lost, even under burst delivery ---------

	suite('A1.3 terminal-not-lost', () => {

		test('a burst of notifications in a single chunk is delivered in order, terminal event included', async () => {
			const peer = makeFakePeer();
			const client = new CodexAppServerClient(peer.transport);
			try {
				const received: string[] = [];
				const handles = [
					client.onNotification('turn/started', () => received.push('turn/started')),
					client.onNotification('item/started', () => received.push('item/started')),
					client.onNotification('item/completed', () => received.push('item/completed')),
					client.onNotification('turn/completed', () => received.push('turn/completed')),
				];
				const lines: string[] = [JSON.stringify({ method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_a' } } })];
				for (let i = 0; i < 200; i++) {
					lines.push(JSON.stringify({ method: 'item/started', params: { threadId: 'thr_1', turnId: 'turn_a', item: { type: 'reasoning', id: `r_${i}` } } }));
					lines.push(JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_1', turnId: 'turn_a', item: { type: 'reasoning', id: `r_${i}` } } }));
				}
				lines.push(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thr_1', turn: { id: 'turn_a', status: 'completed' } } }));
				// One single chunk: a slow consumer cannot drop the terminal event,
				// it only delays the loop.
				peer.transport.stdout.emit('data', lines.join('\n') + '\n');
				await new Promise(r => setImmediate(r));
				assert.strictEqual(received.length, 402, 'every notification delivered');
				assert.strictEqual(received[0], 'turn/started');
				assert.strictEqual(received[received.length - 1], 'turn/completed', 'terminal event is delivered last, not dropped');
				for (const h of handles) {
					h.dispose();
				}
			} finally {
				client.dispose();
				peer.dispose();
			}
		});

		test('turn/completed finalizes orphaned tool calls instead of dropping the terminal action', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			const { actions } = harness.turnCompleted('turn_a', 'completed');
			const types = actions.map(a => a.type);
			assert.ok(types.includes(ActionType.ChatToolCallComplete), 'orphaned tool call is force-completed');
			assert.ok(types.includes(ActionType.ChatTurnComplete), 'terminal action is always emitted');
			assert.strictEqual(harness.chat.activeTurn, undefined);
			assert.strictEqual(harness.chat.turns.at(-1)?.state, TurnState.Complete);
		});
	});

	// -- A1.4: interrupt → cancelled terminal state ------------------------------

	suite('A1.4 interrupt-consistency', () => {

		test('turn/completed with status interrupted maps to ChatTurnCancelled and clears the active turn', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			assert.strictEqual(harness.mapState.currentTurnId, 'turn_a');
			const { actions } = harness.turnCompleted('turn_a', 'interrupted');
			assert.deepStrictEqual(terminalActionTypes(actions), [ActionType.ChatTurnCancelled]);
			assert.strictEqual(harness.mapState.currentTurnId, undefined, 'mapper no longer considers a turn active');
			assert.strictEqual(harness.chat.activeTurn, undefined, 'AHP activeTurn cleared — no "process running but AHP cancelled" split-brain');
			assert.strictEqual(harness.chat.turns.at(-1)?.state, TurnState.Cancelled);
		});

		test('interrupted turn force-cancels open tool calls in the reducer', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			harness.turnCompleted('turn_a', 'interrupted');
			const turn = harness.chat.turns.at(-1)!;
			const toolParts = turn.responseParts.filter((p): p is ToolCallResponsePart => p.kind === ResponsePartKind.ToolCall);
			assert.ok(toolParts.length > 0, 'fixture must contain at least one tool call for this assertion to be meaningful');
			for (const part of toolParts) {
				// Assert against the real non-terminal set — there is no
				// `ToolCallStatus.InProgress` member, so a single-value
				// comparison against it would be vacuous.
				assert.ok(!NON_TERMINAL_TOOL_STATUSES.includes(part.toolCall.status), `no tool call left in non-terminal status '${part.toolCall.status}' after interrupt`);
			}
		});
	});

	// -- A1.5: exhaustive transition table ----------------------------------------

	suite('A1.5 transition-table exhaustion', () => {

		const TERMINALS: readonly { readonly status: 'completed' | 'failed' | 'interrupted'; readonly expectedTurnState: TurnState; readonly expectedTerminal: ActionType }[] = [
			{ status: 'completed', expectedTurnState: TurnState.Complete, expectedTerminal: ActionType.ChatTurnComplete },
			{ status: 'failed', expectedTurnState: TurnState.Error, expectedTerminal: ActionType.ChatTurnComplete },
			{ status: 'interrupted', expectedTurnState: TurnState.Cancelled, expectedTerminal: ActionType.ChatTurnCancelled },
		];

		for (const terminal of TERMINALS) {
			test(`legal path idle → started → active → ${terminal.status} (${terminal.expectedTurnState})`, () => {
				const harness = new TurnHarness();

				// idle → started
				const start = harness.turnStarted('turn_a');
				assert.deepStrictEqual(start.actions.map(a => a.type), [ActionType.ChatTurnStarted]);
				assert.strictEqual(harness.chat.activeTurn?.id, 'turn_a');

				// started → active (items streaming)
				harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
				harness.itemCompleted(commandCompletedParams('cmd_1', 'turn_a'));
				harness.itemStarted(agentMessageStartedParams('msg_1', 'turn_a'));
				assert.strictEqual(harness.chat.activeTurn?.id, 'turn_a', 'still active while items stream');

				// active → terminal
				const end = harness.turnCompleted('turn_a', terminal.status);
				assert.deepStrictEqual(terminalActionTypes(end.actions), [terminal.expectedTerminal], 'exactly one terminal action');
				if (terminal.status === 'failed') {
					assert.ok(end.actions.some(a => a.type === ActionType.ChatError), 'failed turn emits an error part before completing');
				}
				assert.strictEqual(harness.chat.activeTurn, undefined);
				assert.strictEqual(harness.chat.turns.length, 1);
				assert.strictEqual(harness.chat.turns[0].state, terminal.expectedTurnState);

				// terminal → started (next turn is legal)
				harness.turnStarted('turn_b');
				assert.strictEqual(harness.chat.activeTurn?.id, 'turn_b');
			});
		}

		test('illegal: turn/completed without turn/started is normalized to a no-op', () => {
			const harness = new TurnHarness();
			const before = harness.chat;
			// The mapper still emits the action (it is a pure translator); the
			// reducer rejects the illegal transition because no activeTurn matches.
			harness.turnCompleted('turn_ghost', 'completed');
			assert.strictEqual(harness.chat, before, 'state untouched by a terminal event for a turn that never started');
			assert.strictEqual(harness.chat.turns.length, 0);
		});

		test('illegal: turn/completed for a different turn id does not end the active turn', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			const before = harness.chat;
			harness.turnCompleted('turn_other', 'completed');
			assert.strictEqual(harness.chat, before, 'foreign terminal event is ignored');
			assert.strictEqual(harness.chat.activeTurn?.id, 'turn_a');
		});

		test('illegal: item/completed for an unknown item id is normalized to no actions', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			const { actions } = harness.itemCompleted(commandCompletedParams('cmd_unknown', 'turn_a'));
			assert.deepStrictEqual(actions, [], 'unknown item completion produces nothing');
		});

		for (const terminal of TERMINALS) {
			test(`illegal: post-terminal activity for the ended turn cannot regress ${terminal.status} → active (monotonicity)`, () => {
				const harness = new TurnHarness();
				harness.turnStarted('turn_a');
				harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
				harness.turnCompleted('turn_a', terminal.status);
				const finalized = harness.chat;
				assert.strictEqual(finalized.turns[0].state, terminal.expectedTurnState);

				// Late items for the ended turn id: the mapper may translate them,
				// but the reducer must not resurrect the turn. (The chat-level
				// status summary may recompute; the TURN is what must be frozen.)
				harness.itemStarted(agentMessageStartedParams('msg_late', 'turn_a'));
				harness.itemStarted(commandStartedParams('cmd_late', 'turn_a'));
				assert.strictEqual(harness.chat.activeTurn, undefined, 'completed → active is impossible');
				assert.strictEqual(harness.chat.turns.length, 1, 'no new turn is appended');
				assert.strictEqual(harness.chat.turns[0], finalized.turns[0], 'the finalized turn record is untouched');
				assert.strictEqual(harness.chat.turns[0].state, terminal.expectedTurnState);
			});
		}

		test('illegal: a second terminal event for the same turn is a no-op', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.turnCompleted('turn_a', 'completed');
			const finalized = harness.chat;
			harness.turnCompleted('turn_a', 'failed');
			assert.strictEqual(harness.chat, finalized, 'completed turn cannot be re-terminated as failed');
			assert.strictEqual(harness.chat.turns[0].state, TurnState.Complete);
		});

		test('every emitted turn lifecycle sequence satisfies: one start, parts while active, exactly one terminal, nothing after', () => {
			// Property-style check over a mixed legal sequence of two turns.
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			harness.itemCompleted(commandCompletedParams('cmd_1', 'turn_a'));
			harness.turnCompleted('turn_a', 'failed');
			harness.turnStarted('turn_b');
			harness.itemStarted(agentMessageStartedParams('msg_1', 'turn_b'));
			harness.turnCompleted('turn_b', 'interrupted');

			for (const turnId of ['turn_a', 'turn_b']) {
				const seq = actionsForTurn(harness.allActions, turnId).map(a => a.type);
				assert.strictEqual(seq.filter(t => t === ActionType.ChatTurnStarted).length, 1, `${turnId}: exactly one start`);
				assert.strictEqual(seq[0], ActionType.ChatTurnStarted, `${turnId}: start is first`);
				const terminals = seq.filter(t => t === ActionType.ChatTurnComplete || t === ActionType.ChatTurnCancelled);
				assert.strictEqual(terminals.length, 1, `${turnId}: exactly one terminal`);
				assert.strictEqual(seq[seq.length - 1], terminals[0], `${turnId}: terminal is last`);
			}
		});
	});

	// -- A2.2: completed item state never regresses on a duplicate start ---------

	suite('A2.2 no-status-regression', () => {

		test('mapItemCompleted then mapItemStarted with the same id does not revert the completed tool call', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			const startedActions = harness.allActions.slice();
			const startAction = startedActions.find(a => a.type === ActionType.ChatToolCallStart) as { toolCallId: string };
			const firstToolCallId = startAction.toolCallId;

			harness.itemCompleted(commandCompletedParams('cmd_1', 'turn_a', { status: 'failed', exitCode: 2 }));
			const afterComplete = harness.chat;
			const completedPart = afterComplete.activeTurn!.responseParts.find(
				(p): p is ToolCallResponsePart => (p as ToolCallResponsePart).toolCall?.toolCallId === firstToolCallId,
			)!;
			assert.strictEqual(completedPart.toolCall.status, ToolCallStatus.Completed);

			// A duplicate item/started for the same item id arrives (codex re-run
			// or replay artifact). The mapper must allocate a FRESH tool call; the
			// completed one is immutable in the reducer.
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			const newStart = harness.allActions.slice(startedActions.length).find(a => a.type === ActionType.ChatToolCallStart) as { toolCallId: string } | undefined;
			assert.ok(newStart, 'duplicate start still surfaces as a tool call');
			assert.notStrictEqual(newStart!.toolCallId, firstToolCallId, 'a new tool call id is allocated — the completed call cannot be overwritten');

			const partNow = harness.chat.activeTurn!.responseParts.find(
				(p): p is ToolCallResponsePart => (p as ToolCallResponsePart).toolCall?.toolCallId === firstToolCallId,
			)!;
			assert.strictEqual(partNow.toolCall.status, ToolCallStatus.Completed, 'authoritative terminal status unchanged');
		});

		test('declined item completion keeps its denied error through a duplicate start', () => {
			const harness = new TurnHarness();
			harness.turnStarted('turn_a');
			harness.itemStarted(commandStartedParams('cmd_1', 'turn_a'));
			const toolCallId = harness.mapState.itemToToolCall.get('cmd_1')!.toolCallId;
			harness.mapState.declinedToolCalls.add(toolCallId);
			harness.itemCompleted(commandCompletedParams('cmd_1', 'turn_a', { status: 'failed', exitCode: null }));
			const part = harness.chat.activeTurn!.responseParts.find(
				(p): p is ToolCallResponsePart => (p as ToolCallResponsePart).toolCall?.toolCallId === toolCallId,
			)!;
			assert.strictEqual(part.toolCall.status, ToolCallStatus.Completed);
			assert.strictEqual((part.toolCall as { error?: { code?: string } }).error?.code, 'denied');
		});
	});
});
