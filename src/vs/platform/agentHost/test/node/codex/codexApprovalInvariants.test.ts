/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PassThrough } from 'stream';
import { Emitter } from '../../../../../base/common/event.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { PendingRequestRegistry } from '../../../common/pendingRequestRegistry.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputResponseKind, ToolCallConfirmationReason } from '../../../common/state/sessionState.js';
import { ActionType, type ChatAction, type SessionAction } from '../../../common/state/sessionActions.js';
import { CodexAgent } from '../../../node/codex/codexAgent.js';
import { CodexAppServerClient, type ICodexAppServerTransport } from '../../../node/codex/codexAppServerClient.js';
import { createCodexSessionMapState, mapItemStarted } from '../../../node/codex/codexMapAppServerEvents.js';
import type { CommandExecutionApprovalDecision } from '../../../node/codex/protocol/generated/v2/CommandExecutionApprovalDecision.js';
import type { ItemGuardianApprovalReviewCompletedNotification } from '../../../node/codex/protocol/generated/v2/ItemGuardianApprovalReviewCompletedNotification.js';
import type { ToolRequestUserInputQuestion } from '../../../node/codex/protocol/generated/v2/ToolRequestUserInputQuestion.js';
import { narrowAdditionalDirectories, resolveCodexPermissions } from '../../../node/codex/codexSessionConfigKeys.js';
import { CodexSessionConfigKey } from '../../../common/codexSessionConfigKeys.js';

/**
 * D12 / Issue #14 — A3 approval-closure invariants (highest-risk area).
 *
 * The CodexAgent methods under test are invoked on the prototype with a minimal
 * harness `this`, the same pattern `codexAgent.test.ts` uses, so no app-server
 * process, filesystem, or network is involved.
 */

// ---- CodexAgent prototype seams ----------------------------------------------

type ApprovalDecision = CommandExecutionApprovalDecision;

interface IApprovalSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	currentTurnId: string | undefined;
	readonly mapState: ReturnType<typeof createCodexSessionMapState>;
	readonly acceptedForSession: Set<string>;
	readonly pendingCommandApprovals: PendingRequestRegistry<ApprovalDecision>;
	readonly pendingUserInputs: PendingRequestRegistry<{ response: ChatInputResponseKind; answers?: Record<string, never> }>;
	readonly pendingGuardianReviewCards: Set<string>;
	readonly handledGuardianReviews: Set<string>;
	readonly hostTurnIdByAppTurnId: Map<string, string>;
	agentMergeTurn?: boolean;
}

interface IApprovalHarness {
	readonly _logService: NullLogService;
	readonly _sessions: Map<string, IApprovalSession>;
	readonly _sessionIdByThreadId: Map<string, string>;
	readonly _subagentsByThreadId: Map<string, never>;
	readonly fired: { uri: string; action: SessionAction | ChatAction }[];
	_fire(uri: URI, action: SessionAction | ChatAction): void;
	_resolveApprovalTarget(threadId: string): { readonly session: IApprovalSession } | undefined;
	_fireApproval(target: { readonly session: IApprovalSession }, action: SessionAction | ChatAction): void;
	_hostTurnId(session: IApprovalSession, appTurnId: string): string;
}

function makeSession(sessionId = 'sess_1', threadId = 'thr_1'): IApprovalSession {
	return {
		sessionId,
		sessionUri: URI.parse(`vscode-agent-session://codex/${sessionId}`),
		currentTurnId: 'turn_a',
		mapState: createCodexSessionMapState(),
		acceptedForSession: new Set(),
		pendingCommandApprovals: new PendingRequestRegistry<ApprovalDecision>(),
		pendingUserInputs: new PendingRequestRegistry(),
		pendingGuardianReviewCards: new Set(),
		handledGuardianReviews: new Set(),
		hostTurnIdByAppTurnId: new Map(),
	};
}

function makeHarness(...sessions: { session: IApprovalSession; threadId: string }[]): IApprovalHarness {
	const bySessionId = new Map(sessions.map(s => [s.session.sessionId, s.session]));
	const byThreadId = new Map(sessions.map(s => [s.threadId, s.session.sessionId]));
	const fired: IApprovalHarness['fired'] = [];
	const harness: IApprovalHarness = {
		_logService: new NullLogService(),
		_sessions: bySessionId as Map<string, IApprovalSession>,
		_sessionIdByThreadId: byThreadId,
		_subagentsByThreadId: new Map(),
		fired,
		_fire(uri, action) { fired.push({ uri: uri.toString(), action }); },
		_resolveApprovalTarget(threadId) {
			const sessionId = byThreadId.get(threadId);
			const session = sessionId ? bySessionId.get(sessionId) : undefined;
			return session ? { session } : undefined;
		},
		_fireApproval(target, action) { fired.push({ uri: target.session.sessionUri.toString(), action }); },
		_hostTurnId(_session, appTurnId) { return appTurnId; },
	};
	return harness;
}

/** Register a host tool call for an app-server item id so approvals can find it. */
function registerToolCallItem(session: IApprovalSession, itemId: string, turnId = 'turn_a'): string {
	mapItemStarted(session.mapState, {
		item: {
			type: 'commandExecution', id: itemId,
			command: 'rm -rf /', cwd: '/tmp', processId: null,
			source: 'agent' as never, status: 'inProgress' as never,
			commandActions: [], aggregatedOutput: null,
			exitCode: null, durationMs: null,
		} as never,
		threadId: 'thr_1', turnId, startedAtMs: 0,
	});
	return session.mapState.itemToToolCall.get(itemId)!.toolCallId;
}

function callPrivate<TThis, TArgs extends unknown[], TResult>(name: string, harness: TThis, ...args: TArgs): TResult {
	const fn = (CodexAgent.prototype as unknown as Record<string, (this: TThis, ...args: TArgs) => TResult>)[name];
	assert.strictEqual(typeof fn, 'function', `CodexAgent.prototype.${name} must exist (test harness drift)`);
	return fn.apply(harness, args);
}

/** Settles in `ms` with 'pending' if the promise has not resolved by then. */
async function pendingAfter<T>(promise: Promise<T>, ms: number): Promise<'pending' | T> {
	return Promise.race([promise.then(v => v as T), new Promise<'pending'>(r => setTimeout(() => r('pending'), ms))]);
}

// ---- Fake app-server transport (wire-level fail-open assertion) ---------------

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
		push(message: object) { clientStdout.write(JSON.stringify(message) + '\n'); },
		dispose() { exitEmitter.dispose(); clientStdin.destroy(); clientStdout.destroy(); },
	};
}

function readAllMessages(stream: PassThrough, into: unknown[]): void {
	let buf = '';
	stream.on('data', (chunk: Buffer | string) => {
		buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		let nl: number;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line) {
				into.push(JSON.parse(line));
			}
		}
	});
}

suite('codexApprovalInvariants (D12 / A3)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// -- A3.1 (unit side): pending registry drains on every unwind path ----------

	suite('A3.1 pendingRequestRegistry turn-terminal drain', () => {

		test('denyAll resolves every parked request with the deny value and empties the registry', async () => {
			const registry = new PendingRequestRegistry<ApprovalDecision>();
			const p1 = registry.register('a');
			const p2 = registry.register('b');
			registry.denyAll('decline');
			assert.strictEqual([...registry.entries()].length, 0, 'turn-terminal cleanup leaves no pending entries');
			assert.strictEqual(await p1, 'decline');
			assert.strictEqual(await p2, 'decline');
		});

		test('rejectAll rejects every parked request and empties the registry', async () => {
			const registry = new PendingRequestRegistry<ApprovalDecision>();
			const p1 = registry.register('a');
			const p2 = registry.register('b');
			const settled = Promise.allSettled([p1, p2]);
			registry.rejectAll(new CancellationError());
			const results = await settled;
			assert.ok(results.every(r => r.status === 'rejected'));
			assert.strictEqual([...registry.entries()].length, 0);
		});

		test('registerAndFire is atomic: a synchronous responder inside fire() resolves the parked promise', async () => {
			const registry = new PendingRequestRegistry<ApprovalDecision>();
			const promise = registry.registerAndFire('k', () => {
				assert.strictEqual(registry.respond('k', 'accept'), true, 'responder sees the registration');
			});
			assert.strictEqual(await promise, 'accept');
			assert.strictEqual([...registry.entries()].length, 0);
		});

		test('re-registering a duplicate key cancels the previous awaiter instead of leaking it', async () => {
			const registry = new PendingRequestRegistry<ApprovalDecision>();
			const first = registry.register('dup');
			const settled = first.then(() => 'resolved', err => err);
			const second = registry.register('dup');
			const firstResult = await settled;
			assert.ok(firstResult instanceof CancellationError, 'stale awaiter unwinds');
			registry.respond('dup', 'decline');
			assert.strictEqual(await second, 'decline');
		});
	});

	// -- A3.2: fail-open is forbidden ---------------------------------------------

	suite('A3.2 no-fail-open', () => {

		test('an unanswered command approval parks forever: no completion, no side effect, no terminal state', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const toolCallId = registerToolCallItem(session, 'cmd_1');
			harness.fired.length = 0;

			const decisionPromise = callPrivate<IApprovalHarness, [never], Promise<ApprovalDecision>>(
				'_handleCommandApprovalRequest',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'cmd_1', command: 'rm -rf /', reason: null } as never,
			);

			// Give the handler every chance to (incorrectly) auto-resolve.
			assert.strictEqual(await pendingAfter(decisionPromise, 150), 'pending', 'the approval must hang until an explicit decision');

			// (a) no item/completed was fabricated: the tracked tool call is still open.
			assert.ok(session.mapState.itemToToolCall.has('cmd_1'), 'item stays open while approval is pending');
			// (b)+(c) the only observable effect is the approval card itself: no
			// ChatToolCallComplete, no ChatTurnComplete/Cancelled — nothing that
			// would correspond to a filesystem change or a command run.
			const firedTypes = harness.fired.map(f => f.action.type);
			assert.deepStrictEqual(firedTypes, [ActionType.ChatToolCallReady], 'only the pending-confirmation card is emitted');
			// (d) the turn did not enter a terminal state.
			assert.strictEqual(session.currentTurnId, 'turn_a', 'turn is still active (suspended), not terminated');

			// Cleanup: explicit decline unwinds the parked approval.
			session.pendingCommandApprovals.respond(toolCallId, 'decline');
			assert.strictEqual(await decisionPromise, 'decline');
		});

		test('wire level: a parked server request produces NO response bytes until the handler answers', async () => {
			const peer = makeFakePeer();
			const client = new CodexAppServerClient(peer.transport);
			const outbound: { id?: number; result?: unknown; error?: unknown }[] = [];
			readAllMessages(peer.outbound, outbound);
			try {
				let release!: (value: unknown) => void;
				const gate = new Promise(r => { release = r; });
				const handle = client.onRequest('item/commandExecution/requestApproval', async () => {
					await gate;
					return { result: { decision: 'decline' } };
				});
				peer.push({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr_1', turnId: 'turn_a', itemId: 'cmd_1' } });
				await new Promise(r => setTimeout(r, 50));
				assert.deepStrictEqual(outbound, [], 'no auto-answer (fail-open) is ever written to the wire');
				release(undefined);
				await new Promise(r => setTimeout(r, 10));
				assert.strictEqual(outbound.length, 1);
				assert.deepStrictEqual(outbound[0], { id: 42, result: { decision: 'decline' } });
				handle.dispose();
			} finally {
				client.dispose();
				peer.dispose();
			}
		});

		test('respondToPermissionRequest(false) resolves the parked approval as decline and marks the tool call denied', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const toolCallId = registerToolCallItem(session, 'cmd_1');

			const decisionPromise = callPrivate<IApprovalHarness, [never], Promise<ApprovalDecision>>(
				'_handleCommandApprovalRequest',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'cmd_1', command: 'rm -rf /', reason: null } as never,
			);
			await new Promise(r => setImmediate(r));
			callPrivate<IApprovalHarness, [string, boolean], void>('respondToPermissionRequest', harness, toolCallId, false);
			assert.strictEqual(await decisionPromise, 'decline');
			assert.ok(session.mapState.declinedToolCalls.has(toolCallId), 'decline is remembered so item/completed maps to userCancelled');
		});
	});

	// -- A3.3: malformed decisions normalize to decline ----------------------------

	suite('A3.3 decision normalization', () => {

		const VALID: readonly ApprovalDecision[] = ['accept', 'acceptForSession', 'decline', 'cancel'];

		async function narrowViaFileChangeRpc(decision: unknown): Promise<string> {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			registerToolCallItem(session, 'fc_1');
			// Stub the user-facing half so we can feed the exact decision the
			// workbench (or a buggy responder) produced.
			(harness as unknown as Record<string, unknown>)._requestItemApproval = async () => decision;
			const response = await callPrivate<IApprovalHarness, [never], Promise<{ result: { decision: string } }>>(
				'_handleFileChangeApprovalRequestRpc',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'fc_1', reason: null } as never,
			);
			return response.result.decision;
		}

		for (const decision of VALID) {
			test(`valid decision '${decision}' passes through unchanged`, async () => {
				assert.strictEqual(await narrowViaFileChangeRpc(decision), decision);
			});
		}

		const MALFORMED: readonly { name: string; value: unknown }[] = [
			{ name: 'acceptWithExecpolicyAmendment struct', value: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['allow_rule'] } } },
			{ name: 'applyNetworkPolicyAmendment struct', value: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com', action: 'allow' } } } },
			{ name: 'unknown string', value: 'acceptEverything' },
			{ name: 'empty string', value: '' },
			{ name: 'null', value: null },
			{ name: 'undefined', value: undefined },
			{ name: 'number', value: 1 },
			{ name: 'plain object', value: {} },
			{ name: 'array', value: ['accept'] },
		];

		for (const { name, value } of MALFORMED) {
			test(`malformed decision (${name}) normalizes to 'decline'`, async () => {
				assert.strictEqual(await narrowViaFileChangeRpc(value), 'decline');
			});
		}

		test('unknown threadId declines without touching any registry', async () => {
			const harness = makeHarness();
			const decision = await callPrivate<IApprovalHarness, [never], Promise<ApprovalDecision>>(
				'_handleCommandApprovalRequest',
				harness,
				{ threadId: 'thr_unknown', turnId: 'turn_a', itemId: 'cmd_1', command: 'ls', reason: null } as never,
			);
			assert.strictEqual(decision, 'decline');
			assert.deepStrictEqual(harness.fired, [], 'no approval card is emitted for an unknown thread');
		});

		test('unknown itemId declines without touching the registry', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const decision = await callPrivate<IApprovalHarness, [never], Promise<ApprovalDecision>>(
				'_handleCommandApprovalRequest',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'cmd_unknown', command: 'ls', reason: null } as never,
			);
			assert.strictEqual(decision, 'decline');
			assert.strictEqual([...session.pendingCommandApprovals.entries()].length, 0, 'nothing is parked for an unknown item');
		});
	});

	// -- A3.5: writeStdin approvals never mutate the parent commandExecution -----

	suite('A3.5 writeStdin isolation', () => {

		test('a denied writeStdin guardian review renders its own card and leaves the parent item untouched', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const parentToolCallId = registerToolCallItem(session, 'cmd_parent');
			harness.fired.length = 0;

			const params = {
				threadId: 'thr_1',
				turnId: 'turn_a',
				reviewId: 'rev_1',
				startedAtMs: 0,
				completedAtMs: 1,
				decisionSource: null,
				targetItemId: 'cmd_parent',
				action: { type: 'writeStdin', approvalId: 'appr_1', processId: 7, stdin: 'y\n', cwd: '/tmp' },
				review: { status: 'denied', riskLevel: null, userAuthorization: null, rationale: 'writes to a REPL' },
			} as unknown as ItemGuardianApprovalReviewCompletedNotification;

			const done = callPrivate<IApprovalHarness, [undefined, ItemGuardianApprovalReviewCompletedNotification], Promise<void>>(
				'_handleGuardianReviewCompleted', harness, undefined, params,
			);
			await new Promise(r => setImmediate(r));

			// The approval card was minted with a FRESH tool call id, not the parent's.
			const cardStart = harness.fired.find(f => f.action.type === ActionType.ChatToolCallStart)!.action as { toolCallId: string };
			assert.notStrictEqual(cardStart.toolCallId, parentToolCallId, 'guardian approval never reuses the parent commandExecution tool call');

			// Decline it. The parent commandExecution item must be completely unaffected.
			session.pendingCommandApprovals.respond(cardStart.toolCallId, 'decline');
			await done;

			const parentEntry = session.mapState.itemToToolCall.get('cmd_parent');
			assert.ok(parentEntry, 'parent item still tracked (its lifecycle belongs to item/completed)');
			assert.strictEqual(parentEntry.toolCallId, parentToolCallId);
			const completesForParent = harness.fired.filter(f => f.action.type === ActionType.ChatToolCallComplete && (f.action as { toolCallId: string }).toolCallId === parentToolCallId);
			assert.deepStrictEqual(completesForParent, [], 'no completion is ever synthesized for the parent item by the writeStdin approval path');
		});
	});

	// -- A3.6: permission grant subset semantics + config narrowing ---------------

	suite('A3.6 permissions subset semantics', () => {

		interface IPermissionsParams {
			readonly threadId: string;
			readonly turnId: string;
			readonly itemId: string;
			readonly reason?: string | null;
			readonly permissions: { network?: unknown; fileSystem?: unknown };
		}

		async function runPermissionsApproval(decision: ApprovalDecision, permissions: IPermissionsParams['permissions'], agentMergeTurn = false): Promise<{ permissions: unknown; scope: string }> {
			const session = makeSession();
			session.agentMergeTurn = agentMergeTurn;
			const harness = makeHarness({ session, threadId: 'thr_1' });
			registerToolCallItem(session, 'perm_1');
			(harness as unknown as Record<string, unknown>)._requestItemApproval = async () => decision;
			const response = await callPrivate<IApprovalHarness, [never], Promise<{ result: { permissions: never; scope: string } }>>(
				'_handlePermissionsApprovalRequestRpc',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'perm_1', reason: null, permissions } as never,
			);
			return response.result;
		}

		test('accept grants exactly the requested permissions', async () => {
			const requested = { network: { enabled: true }, fileSystem: { read: ['/a'], write: ['/b'] } };
			const result = await runPermissionsApproval('accept', requested);
			assert.deepStrictEqual(result.permissions, requested, 'grants are a subset of (equal to) the request — never more');
			assert.strictEqual(result.scope, 'turn');
		});

		test('decline and cancel grant nothing at all', async () => {
			for (const decision of ['decline', 'cancel'] as const) {
				const result = await runPermissionsApproval(decision, { network: { enabled: true } });
				assert.deepStrictEqual(result.permissions, {}, `${decision}: permissions not present in the result are denied`);
				assert.strictEqual(result.scope, 'turn');
			}
		});

		test('only acceptForSession carries scope session (cross-turn)', async () => {
			const requested = { network: { enabled: true } };
			const forSession = await runPermissionsApproval('acceptForSession', requested);
			assert.strictEqual(forSession.scope, 'session');
			assert.deepStrictEqual(forSession.permissions, { network: requested.network, fileSystem: undefined });
			const accept = await runPermissionsApproval('accept', requested);
			assert.strictEqual(accept.scope, 'turn', 'plain accept never escapes the turn');
		});

		test('null/absent permission entries in the request are omitted from the grant', async () => {
			const result = await runPermissionsApproval('accept', { network: null, fileSystem: { read: ['/a'] } });
			assert.deepStrictEqual(result.permissions, { network: undefined, fileSystem: { read: ['/a'] } });
			assert.strictEqual((result.permissions as Record<string, unknown>).network, undefined, 'a null request entry cannot be granted');
		});

		test('Agent Merge turns never receive network escalation', async () => {
			const result = await runPermissionsApproval('accept', { network: { enabled: true } }, true);
			assert.deepStrictEqual(result.permissions, {}, 'network escalation is denied outright during Agent Merge');
			assert.strictEqual(result.scope, 'turn');
		});

		test('resolveCodexPermissions: preset wins over legacy axes; garbage falls back to defaults', () => {
			const defaults = { approvalPolicy: 'untrusted' as const, sandboxMode: 'read-only' as const };
			// preset present → expands, ignoring legacy keys
			assert.deepStrictEqual(
				resolveCodexPermissions({ [CodexSessionConfigKey.PermissionsPreset]: 'full-access', [CodexSessionConfigKey.ApprovalPolicy]: 'untrusted' }, defaults),
				{ approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalsReviewer: 'user' },
			);
			// legacy axes only
			assert.deepStrictEqual(
				resolveCodexPermissions({ [CodexSessionConfigKey.ApprovalPolicy]: 'untrusted', [CodexSessionConfigKey.SandboxMode]: 'read-only' }, defaults),
				{ approvalPolicy: 'untrusted', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			);
			// malformed values → defaults, never silent widening
			assert.deepStrictEqual(
				resolveCodexPermissions({ [CodexSessionConfigKey.ApprovalPolicy]: 'yolo', [CodexSessionConfigKey.SandboxMode]: 42 }, defaults),
				{ approvalPolicy: 'untrusted', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			);
			// undefined config → defaults
			assert.deepStrictEqual(
				resolveCodexPermissions(undefined, defaults),
				{ approvalPolicy: 'untrusted', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			);
			// unknown preset string is ignored, legacy axes apply
			assert.deepStrictEqual(
				resolveCodexPermissions({ [CodexSessionConfigKey.PermissionsPreset]: 'god-mode', [CodexSessionConfigKey.SandboxMode]: 'read-only' }, defaults),
				{ approvalPolicy: 'untrusted', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			);
		});

		test('narrowAdditionalDirectories: non-arrays and junk entries never widen the sandbox', () => {
			assert.strictEqual(narrowAdditionalDirectories(undefined), undefined);
			assert.strictEqual(narrowAdditionalDirectories('/etc'), undefined);
			assert.strictEqual(narrowAdditionalDirectories(42), undefined);
			assert.strictEqual(narrowAdditionalDirectories({ path: '/etc' }), undefined);
			assert.deepStrictEqual(narrowAdditionalDirectories([]), []);
			assert.deepStrictEqual(narrowAdditionalDirectories(['/data', '', 42, null, '/more']), ['/data', '/more'], 'empty strings and non-strings are dropped');
		});
	});

	// -- A3.7: isBlocking waits forever; autoResolutionMs is never read ------------

	suite('A3.7 blocking user input', () => {

		const QUESTIONS: readonly ToolRequestUserInputQuestion[] = [{
			id: 'q1', header: 'Pick', question: 'Proceed?', options: null, isOther: false,
		} as unknown as ToolRequestUserInputQuestion];

		test('isBlocking:true with a deprecated autoResolutionMs set still parks until explicit input', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const responsePromise = callPrivate<IApprovalHarness, [never], Promise<{ result: unknown }>>(
				'_handleUserInputRequestRpc',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'item_1', questions: QUESTIONS, isBlocking: true, autoResolutionMs: 1 } as never,
			);
			// autoResolutionMs: 1 must NOT auto-answer: still parked well past 1ms.
			assert.strictEqual(await pendingAfter(responsePromise, 150), 'pending', 'a blocking request waits indefinitely for explicit input');

			const requested = harness.fired.find(f => f.action.type === ActionType.ChatInputRequested)!.action as { request: { id: string } };
			session.pendingUserInputs.respond(requested.request.id, {
				response: ChatInputResponseKind.Accept,
				answers: { q1: { state: ChatInputAnswerState.Settled, value: { kind: ChatInputAnswerValueKind.Text, value: 'yes' } } } as never,
			});
			const response = await responsePromise;
			assert.deepStrictEqual(response.result, { answers: { q1: { answers: ['yes'] } } });
		});

		test('isBlocking:false also waits for explicit input (no auto-resolution path exists)', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const responsePromise = callPrivate<IApprovalHarness, [never], Promise<{ result: unknown }>>(
				'_handleUserInputRequestRpc',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'item_1', questions: QUESTIONS, isBlocking: false, autoResolutionMs: 1 } as never,
			);
			assert.strictEqual(await pendingAfter(responsePromise, 100), 'pending');
			const requested = harness.fired.find(f => f.action.type === ActionType.ChatInputRequested)!.action as { request: { id: string } };
			session.pendingUserInputs.respond(requested.request.id, { response: ChatInputResponseKind.Decline, answers: undefined });
			assert.deepStrictEqual((await responsePromise).result, { answers: { q1: { answers: [] } } });
		});

		test('user input without an active turn answers empty immediately (turn already gone)', async () => {
			const session = makeSession();
			session.currentTurnId = undefined;
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const response = await callPrivate<IApprovalHarness, [never], Promise<{ result: unknown }>>(
				'_handleUserInputRequestRpc',
				harness,
				{ threadId: 'thr_1', turnId: 'turn_a', itemId: 'item_1', questions: QUESTIONS, isBlocking: true, autoResolutionMs: null } as never,
			);
			assert.deepStrictEqual(response.result, { answers: { q1: { answers: [] } } });
			assert.strictEqual(harness.fired.length, 0, 'no input card for a dead turn');
		});
	});

	// -- A3.8: elicitation accept+content is never a permission grant --------------

	suite('A3.8 elicitation ≠ permission', () => {

		test('accepting an elicitation with content grants no permission state whatsoever', async () => {
			const session = makeSession();
			const harness = makeHarness({ session, threadId: 'thr_1' });
			const params = {
				threadId: 'thr_1',
				mode: 'form',
				serverName: 'mcp',
				message: 'Provide config',
				requestedSchema: {
					type: 'object',
					required: ['token'],
					properties: { token: { type: 'string' } },
				},
			} as never;
			const responsePromise = callPrivate<IApprovalHarness, [never], Promise<{ result: { action: string; content: unknown } }>>(
				'_handleElicitationRequestRpc', harness, params,
			);
			await new Promise(r => setImmediate(r));
			const requested = harness.fired.find(f => f.action.type === ActionType.ChatInputRequested)!.action as { request: { id: string } };

			// Answer with content that LOOKS like a permission vocabulary.
			session.pendingUserInputs.respond(requested.request.id, {
				response: ChatInputResponseKind.Accept,
				answers: { token: { state: ChatInputAnswerState.Settled, value: { kind: ChatInputAnswerValueKind.Text, value: 'acceptForSession' } } } as never,
			});
			const response = await responsePromise;

			assert.strictEqual(response.result.action, 'accept');
			assert.deepStrictEqual(response.result.content, { token: 'acceptForSession' }, 'content is opaque string data, not a decision');
			assert.strictEqual([...session.pendingCommandApprovals.entries()].length, 0, 'no approval was ever parked');
			assert.strictEqual(session.acceptedForSession.size, 0, 'no session-scoped acceptance was recorded');
			assert.ok(!harness.fired.some(f => f.action.type === ActionType.ChatToolCallReady), 'no confirmation card was conjured');
		});

		test('elicitation for an unknown thread declines instead of hanging', async () => {
			const harness = makeHarness();
			const response = await callPrivate<IApprovalHarness, [never], Promise<{ result: { action: string } }>>(
				'_handleElicitationRequestRpc',
				harness,
				{ threadId: 'thr_unknown', mode: 'form', serverName: 'mcp', message: 'm', requestedSchema: { type: 'object', properties: {} } } as never,
			);
			assert.strictEqual(response.result.action, 'decline');
		});
	});
});
