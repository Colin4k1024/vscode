/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CCAModel } from '@vscode/copilot-api';
import assert from 'assert';
import { PassThrough } from 'stream';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../telemetry/common/telemetryUtils.js';
import { IAgentPluginManager } from '../../../common/agentPluginManager.js';
import { AgentSession, type AgentSignal, type IAgentChatContext, type IAgentCreateChatOptions, type IAgentCreateChatResult } from '../../../common/agent.js';
import { ActionType, type ChatAction, type SessionAction } from '../../../common/state/sessionActions.js';
import { buildChatUri, buildDefaultChatUri } from '../../../common/state/sessionState.js';
import { ISessionDataService } from '../../../common/sessionDataService.js';
import { AgentConfigurationService, IAgentConfigurationService } from '../../../node/agentConfigurationService.js';
import { IAgentHostWorktreeIsolation, NullAgentHostWorktreeIsolation } from '../../../node/shared/worktreeIsolation.js';
import { IAgentHostCustomizationEnablementService } from '../../../node/agentHostCustomizationEnablementService.js';
import { AgentHostStateManager, IAgentHostStateManager } from '../../../node/agentHostStateManager.js';
import { IAgentHostSessionTitleSignal } from '../../../node/agentHostSessionTitleSignal.js';
import { IAgentHostGitHubEndpointService } from '../../../node/agentHostGitHubEndpointService.js';
import { IAgentHostProxyResolver } from '../../../node/agentHostProxyResolver.js';
import { IAgentSdkDownloader } from '../../../node/agentSdkDownloader.js';
import { IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE } from '../../../common/agentHostCheckpointService.js';
import { IAgentHostOTelService } from '../../../common/otel/agentHostOTelService.js';
import { CodexAgent, toCodexModelSelectionId } from '../../../node/codex/codexAgent.js';
import { CodexAppServerClient, type ICodexAppServerTransport } from '../../../node/codex/codexAppServerClient.js';
import type { ICodexProxyHandle } from '../../../node/codex/codexProxyService.js';
import { ICodexProxyService } from '../../../node/codex/codexProxyService.js';
import { ICopilotApiService } from '../../../node/shared/copilotApiService.js';
import { createTestGitHubEndpointService } from '../testGitHubEndpointService.js';
import { AgentHostCodexMultiRootEnabledConfigKey } from '../../../common/agentHostSchema.js';
import { createSessionDataService } from '../../common/sessionTestHelpers.js';
import { createNoopCustomizationEnablementService } from '../testCustomizationEnablementService.js';
import { createTestAgentHostProxyResolver } from '../agentServiceTestUtils.js';
import { RecordingAgentSdkDownloader } from '../testAgentSdkDownloader.js';

const COPILOT_TEST_MODEL = toCodexModelSelectionId('vscode-proxy', 'gpt-test');

// #region Wire peer
//
// A fake `codex app-server` endpoint: the agent's client writes JSONL to
// `stdin` (which the test reads) and the test pushes JSONL into `stdout`.
// Unlike the one-shot `readNextRequest` helper in codexPrewarmEviction.test,
// requests are line-buffered into a queue so coalesced writes cannot drop a
// message.

interface IWireMessage {
	readonly id?: number;
	readonly method?: string;
	readonly params?: any;
}

class WirePeer {
	readonly client: CodexAppServerClient;
	readonly killSignals: (NodeJS.Signals | undefined)[] = [];
	readonly child: { kill: (signal?: NodeJS.Signals) => boolean; exitCode: number | null; signalCode: NodeJS.Signals | null };
	readonly proxyHandle: ICodexProxyHandle & { readonly disposed: { readonly value: boolean }; readonly tokens: string[] };
	/** Order log shared by child.kill and proxyHandle.dispose (C1.10). */
	readonly orderLog: string[] = [];

	private readonly _stdin = new PassThrough();
	private readonly _stdout = new PassThrough();
	private readonly _onExit = new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();
	private readonly _onceExit: ((e: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void)[] = [];
	private readonly _messages: IWireMessage[] = [];
	private readonly _waiters: ((m: IWireMessage) => void)[] = [];

	constructor(private readonly _disposables: DisposableStore) {
		const transport: ICodexAppServerTransport = {
			stdin: this._stdin,
			stdout: this._stdout,
			kill: signal => {
				this.killSignals.push(signal);
				this.orderLog.push('kill');
				return true;
			},
			onExit: this._onExit.event,
			onExitOnce: listener => this._onceExit.push(listener),
		};
		this._stdin.on('data', chunk => {
			this._drainIn(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
		});
		this.client = this._disposables.add(new CodexAppServerClient(transport));
		const proxyDisposed = { value: false };
		const tokens: string[] = [];
		const orderLog = this.orderLog;
		this.proxyHandle = {
			baseUrl: 'http://127.0.0.1:9',
			nonce: 'test-nonce',
			setToken: (token: string) => { tokens.push(token); },
			dispose: () => {
				if (!proxyDisposed.value) {
					proxyDisposed.value = true;
					orderLog.push('proxyDispose');
				}
			},
			get disposed() { return proxyDisposed; },
			get tokens() { return tokens; },
		} as unknown as WirePeer['proxyHandle'];
		this.child = {
			kill: signal => transport.kill(signal),
			exitCode: null,
			signalCode: null,
		};
	}

	private _pendingIn = '';

	private _drainIn(text: string): void {
		this._pendingIn += text;
		let nl: number;
		while ((nl = this._pendingIn.indexOf('\n')) >= 0) {
			const line = this._pendingIn.slice(0, nl).trim();
			this._pendingIn = this._pendingIn.slice(nl + 1);
			if (!line) {
				continue;
			}
			const message = JSON.parse(line) as IWireMessage;
			const waiter = this._waiters.shift();
			if (waiter) {
				waiter(message);
			} else {
				this._messages.push(message);
			}
		}
	}

	/** Next client→server message, parsed. Fails after `timeoutMs`. */
	nextMessage(timeoutMs = 5_000): Promise<IWireMessage> {
		const queued = this._messages.shift();
		if (queued) {
			return Promise.resolve(queued);
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const index = this._waiters.indexOf(onMessage);
				if (index >= 0) {
					this._waiters.splice(index, 1);
				}
				reject(new Error('WirePeer: timed out waiting for a client message'));
			}, timeoutMs);
			const onMessage = (m: IWireMessage) => {
				clearTimeout(timer);
				resolve(m);
			};
			this._waiters.push(onMessage);
		});
	}

	get pendingMessageCount(): number {
		return this._messages.length;
	}

	/** Inject a server→client message (notification, request, or response). */
	push(message: object): void {
		this._stdout.write(JSON.stringify(message) + '\n');
	}

	/** Simulate the app-server process dying (e.g. SIGKILL). */
	exit(code: number | null = null, signal: NodeJS.Signals | null = 'SIGKILL'): void {
		const e = { code, signal };
		this._onExit.fire(e);
		for (const listener of this._onceExit.splice(0)) {
			listener(e);
		}
	}

	dispose(): void {
		this._onceExit.length = 0;
		this._onExit.dispose();
		this._stdin.destroy();
		this._stdout.destroy();
	}
}

// #endregion

// #region Agent harness (mirrors codexPrewarmEviction.test.ts)

async function createAgent(disposables: DisposableStore): Promise<CodexAgent> {
	const instantiationService = new TestInstantiationService();
	const logService = new NullLogService();
	const fileService = disposables.add(new FileService(logService));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
	const stateManager = disposables.add(new AgentHostStateManager(logService));
	const configurationService = disposables.add(new AgentConfigurationService(stateManager, logService));
	configurationService.updateRootConfig({ [AgentHostCodexMultiRootEnabledConfigKey]: undefined });
	instantiationService.stub(ISessionDataService, createSessionDataService());
	instantiationService.stub(IAgentPluginManager, {
		_serviceBrand: undefined,
		basePath: URI.file('/plugins'),
		syncCustomizations: async (_clientId: string, customizations: any[]) => customizations.map(customization => ({ customization })),
	});
	const copilotModels = [{ id: 'gpt-test', name: 'GPT Test', model_picker_enabled: true, supported_endpoints: ['/responses'], vendor: 'OpenAI' }] as unknown as CCAModel[];
	instantiationService.stub(ICopilotApiService, { _serviceBrand: undefined, models: async () => copilotModels });
	instantiationService.stub(ICodexProxyService, { _serviceBrand: undefined });
	instantiationService.stub(IAgentConfigurationService, configurationService);
	instantiationService.stub(IAgentHostWorktreeIsolation, new NullAgentHostWorktreeIsolation());
	instantiationService.stub(IAgentHostStateManager, stateManager);
	instantiationService.stub(IAgentHostCustomizationEnablementService, createNoopCustomizationEnablementService());
	instantiationService.stub(IAgentHostGitHubEndpointService, createTestGitHubEndpointService());
	instantiationService.stub(IAgentHostProxyResolver, createTestAgentHostProxyResolver());
	instantiationService.stub(IAgentSdkDownloader, new RecordingAgentSdkDownloader());
	instantiationService.stub(IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE);
	instantiationService.stub(IAgentHostOTelService, {
		_serviceBrand: undefined,
		getNativeSdkTelemetryConfig: async () => undefined,
		getSessionTraceContext: () => undefined,
		releaseSessionTraceContext: () => { },
	});
	instantiationService.stub(IAgentHostSessionTitleSignal, { _serviceBrand: undefined, onDidChangeSessionTitle: Event.None });
	instantiationService.stub(IProductService, { _serviceBrand: undefined, version: '1.0.0-test' } as IProductService);
	instantiationService.stub(INativeEnvironmentService, { userHome: URI.file('/tmp') });
	instantiationService.stub(IFileService, fileService);
	instantiationService.stub(ILogService, logService);
	instantiationService.stub(ITelemetryService, NullTelemetryService);
	const agent = disposables.add(instantiationService.createInstance(CodexAgent));
	agent['_probeAccountAtStartup'] = async () => { };
	agent['_activated'] = true;
	await agent.authenticate(agent.getProtectedResources()[0].resource, 'test-token');
	await agent.refreshModels();
	return agent;
}

/** Spin up the agent's persistent connection against `peer` through the real `_startConnection` wiring. */
async function connectAgent(agent: CodexAgent, peer: WirePeer): Promise<unknown> {
	agent['_startRawConnection'] = async () => ({
		client: peer.client,
		proxyHandle: peer.proxyHandle,
		child: peer.child,
	}) as never;
	// Keep background refreshes off the wire so tests own every message.
	agent['_refreshAccount'] = (async () => { }) as never;
	agent['_refreshMcpInventory'] = async () => { };
	agent['_queueSkillExtraRootsForClient'] = async () => { };
	agent['_schedulePrewarm'] = () => { };
	agent['_refreshSkillHookCustomizations'] = async () => { };
	agent['_refreshSkillExtraRoots'] = async () => { };
	return agent['_ensureConnection']();
}

function defaultChatOf(session: URI): URI {
	return URI.parse(buildDefaultChatUri(session));
}

function chatContext(session: URI, chat: URI): IAgentChatContext {
	return { configurationResource: session, resource: chat };
}

async function createSession(agent: CodexAgent, options: IAgentCreateChatOptions & { readonly session?: URI } = {}): Promise<IAgentCreateChatResult & { readonly session: URI }> {
	const { session: requestedSession, ...chatOptions } = options;
	const session = requestedSession ?? AgentSession.uri(agent.id, generateUuid());
	const chat = defaultChatOf(session);
	const result = await agent.chats.createChat(chat, chatContext(session, chat), { deferBacking: !chatOptions.fork && !chatOptions.importConversation, ...chatOptions });
	return { ...result, session };
}

/** Drive one prompt send far enough that `turn/start` has been accepted. Returns the app thread id. */
async function startTurn(peer: WirePeer, agent: CodexAgent, session: URI, prompt = 'hello', turnId = 'turn-1', threadId = 'thread-1'): Promise<{ send: Promise<void>; threadId: string }> {
	const chat = defaultChatOf(session);
	const send = agent.chats.sendMessage(chat, prompt, [URI.file('/repo')], undefined, turnId);
	const threadStart = await peer.nextMessage();
	assert.strictEqual(threadStart.method, 'thread/start');
	peer.push({ id: threadStart.id, result: { thread: { id: threadId } } });
	const turnStart = await peer.nextMessage();
	assert.strictEqual(turnStart.method, 'turn/start');
	peer.push({ id: turnStart.id, result: {} });
	await send;
	return { send, threadId };
}

function actionSignals(signals: AgentSignal[]): (SessionAction | ChatAction)[] {
	return signals.filter(s => s.kind === 'action').map(s => (s as { kind: 'action'; action: SessionAction | ChatAction }).action);
}

/**
 * Background responder: answers every request the agent issues until the
 * returned stop function is called. `thread/start` gets a fresh thread id;
 * everything else gets an empty result. Records all requests for assertions.
 */
function startAutoResponder(peer: WirePeer): { readonly requests: IWireMessage[]; readonly stop: () => void } {
	const requests: IWireMessage[] = [];
	let stopped = false;
	let counter = 0;
	(async () => {
		while (!stopped) {
			let message: IWireMessage;
			try {
				message = await peer.nextMessage();
			} catch {
				return;
			}
			requests.push(message);
			if (message.method === 'thread/start') {
				peer.push({ id: message.id, result: { thread: { id: `auto-thread-${++counter}` } } });
			} else {
				peer.push({ id: message.id, result: {} });
			}
		}
	})();
	return { requests, stop: () => { stopped = true; } };
}

// #endregion

suite('CodexAgent D13 crash / concurrency / recovery negatives (issue #15)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('AC3/AC2: SIGKILLed app-server mid-turn terminates the turn as an error, clears state, denies pending approvals, keeps streamed content, and the next operation rebuilds the connection', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer1 = new WirePeer(disposables);
			await connectAgent(agent, peer1);

			const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
			const signals: AgentSignal[] = [];
			disposables.add(agent.onDidChatProgress(signal => signals.push(signal)));

			await startTurn(peer1, agent, session);
			const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
			assert.strictEqual(sessionEntry.threadId, 'thread-1');

			// Stream partial content, then park an approval request.
			peer1.push({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'appTurn-1', items: [] } } });
			peer1.push({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'appTurn-1', startedAtMs: 0, item: { type: 'agentMessage', id: 'msg_1', text: '', phase: null, memoryCitation: null, delivery: null, questions: null } } });
			peer1.push({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'appTurn-1', itemId: 'msg_1', delta: 'partial answer' } });
			peer1.push({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'appTurn-1', startedAtMs: 0, item: { type: 'commandExecution', id: 'cmd_1', command: 'make all', cwd: '/repo', processId: null, source: 'agent', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null } } });
			await new Promise(r => setImmediate(r));
			const toolCallId = sessionEntry.mapState.itemToToolCall.get('cmd_1')!.toolCallId;

			peer1.push({ id: 100, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'appTurn-1', itemId: 'cmd_1', command: 'make all' } });
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));
			assert.strictEqual(sessionEntry.pendingCommandApprovals.has(toolCallId), true, 'approval request must be parked while awaiting the user');

			// Crash the app-server.
			peer1.exit();
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));

			const actions = actionSignals(signals);
			// (d) streamed content was dispatched before the crash
			const deltaIndex = actions.findIndex(a => a.type === ActionType.ChatDelta && (a as { content?: string }).content === 'partial answer');
			assert.ok(deltaIndex >= 0, 'streamed delta must have been dispatched before the crash');
			// (a) the turn reaches a terminal state — as an error, never as a success (C2.4: not treated as succeeded)
			const errorIndex = actions.findIndex(a => a.type === ActionType.ChatError);
			assert.ok(errorIndex > deltaIndex, 'ChatError must follow the streamed content');
			assert.match((actions[errorIndex] as { part?: { error?: { message?: string } } }).part?.error?.message ?? JSON.stringify(actions[errorIndex]), /disconnected|exited/i);
			const completeIndex = actions.findIndex(a => a.type === ActionType.ChatTurnComplete);
			assert.ok(completeIndex > errorIndex, 'ChatTurnComplete must follow the ChatError');
			// (b) active turn bookkeeping is cleared
			assert.strictEqual(sessionEntry.currentTurnId, undefined, 'currentTurnId must be cleared');
			assert.strictEqual(sessionEntry.currentAppTurnId, undefined, 'currentAppTurnId must be cleared');
			// (c) every pending server request is resolved (A3.1 link: approval awaiters unwind)
			assert.strictEqual(sessionEntry.pendingCommandApprovals.has(toolCallId), false, 'pending approval must be resolved by the crash');
			// recovery intent: the thread must be resumed before the next turn
			assert.strictEqual(sessionEntry.needsResume, true, 'session must require resume after losing its app-server');
			// connection is back to idle
			assert.strictEqual(agent['_connection'].kind, 'idle');

			// (e) the next operation rebuilds the connection against a fresh process
			const peer2 = new WirePeer(disposables);
			agent['_startRawConnection'] = async () => ({
				client: peer2.client,
				proxyHandle: peer2.proxyHandle,
				child: peer2.child,
			}) as never;
			const reconnected = await agent['_ensureConnection']() as unknown as { client: CodexAppServerClient };
			assert.strictEqual(reconnected.client, peer2.client, 'a replacement connection must be established');
			assert.strictEqual(agent['_connection'].kind, 'ready');
		} finally {
			disposables.dispose();
		}
	});

	test('AC2 (C2.4): a crash between turn/start and its result never surfaces the turn as succeeded', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			await connectAgent(agent, peer);
			const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
			const signals: AgentSignal[] = [];
			disposables.add(agent.onDidChatProgress(signal => signals.push(signal)));

			// Send, but crash after `turn/start` has been dispatched without a result.
			const chat = defaultChatOf(session);
			let sendSettled: { ok: boolean; error?: unknown } | undefined;
			const send = agent.chats.sendMessage(chat, 'hello', [URI.file('/repo')], undefined, 'turn-1')
				.then(() => { sendSettled = { ok: true }; }, error => { sendSettled = { ok: false, error }; });
			const threadStart = await peer.nextMessage();
			peer.push({ id: threadStart.id, result: { thread: { id: 'thread-1' } } });
			const turnStart = await peer.nextMessage();
			assert.strictEqual(turnStart.method, 'turn/start');

			peer.exit();
			await send;

			// The turn did not complete successfully: the send promise rejects or the
			// session surfaces an error action — never a silent success.
			const actions = actionSignals(signals);
			const sawErrorAction = actions.some(a => a.type === ActionType.ChatError);
			assert.ok(sendSettled, 'send must settle after the crash');
			assert.ok(sendSettled.ok === false || sawErrorAction, 'a crashed turn/start must surface as a failure, not a success');
			const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
			assert.strictEqual(sessionEntry.currentTurnId, undefined);
			assert.strictEqual(sessionEntry.currentAppTurnId, undefined);
		} finally {
			disposables.dispose();
		}
	});

	test('AC7 (B7): a replaced connection is disposed exactly once and its late events are dropped', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer1 = new WirePeer(disposables);
			const ready1 = await connectAgent(agent, peer1) as object;
			const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
			const signals: AgentSignal[] = [];
			disposables.add(agent.onDidChatProgress(signal => signals.push(signal)));

			// Park a turn on the old connection.
			const chat = defaultChatOf(session);
			const send = agent.chats.sendMessage(chat, 'hello', [URI.file('/repo')], undefined, 'turn-1');
			const threadStart = await peer1.nextMessage();
			peer1.push({ id: threadStart.id, result: { thread: { id: 'thread-1' } } });
			const turnStart = await peer1.nextMessage();
			assert.strictEqual(turnStart.method, 'turn/start');

			// Replace the connection: dispose the current one, then start a new one.
			let disposeCalls = 0;
			const originalDispose = agent['_disposeConnectionResources'].bind(agent);
			agent['_disposeConnectionResources'] = (connection: unknown) => {
				disposeCalls++;
				return originalDispose(connection as never);
			};
			agent['_disposeConnection']();
			const peer2 = new WirePeer(disposables);
			agent['_startRawConnection'] = async () => ({
				client: peer2.client,
				proxyHandle: peer2.proxyHandle,
				child: peer2.child,
			}) as never;
			const ready2 = await agent['_ensureConnection']() as unknown as { client: CodexAppServerClient };
			assert.strictEqual(agent['_connection'].kind, 'ready');
			assert.strictEqual(ready2.client, peer2.client);

			// The old turn/start is aborted (disposed client) — the send unwinds, it must not hang.
			await send;
			const settledActions = actionSignals(signals);
			assert.ok(settledActions.some(a => (a.type === ActionType.ChatError || a.type === ActionType.ChatTurnCancelled) && (a as { turnId?: string }).turnId === 'turn-1'),
				'the send on the replaced connection must visibly terminate its turn');

			// Late traffic from the replaced app-server must not reach the session:
			// the old client's listeners were torn down with its subscriptions.
			peer1.push({ id: turnStart.id, result: {} });
			peer1.push({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'appTurn-late', items: [] } } });
			peer1.push({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'appTurn-late', itemId: 'msg_late', delta: 'late content' } });
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));
			const actions = actionSignals(signals);
			assert.ok(!actions.some(a => a.type === ActionType.ChatDelta && (a as { content?: string }).content === 'late content'), 'late deltas from the replaced app-server must be dropped');
			const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
			assert.strictEqual(sessionEntry.currentAppTurnId, undefined, 'the late turn/started must not register a turn');

			// Disposal of the replaced connection is idempotent — even through the
			// pre-publication wrapper identity (`_ensureConnection` re-wraps the
			// ready record), the shared resources must be disposed exactly once.
			assert.strictEqual(disposeCalls, 1, 'the replaced connection must be disposed exactly once');
			assert.deepStrictEqual(peer1.killSignals, ['SIGKILL'], 'the replaced child must be SIGKILLed once');
			agent['_disposeConnectionResources'](ready1 as never);
			assert.strictEqual(peer1.killSignals.length, 1, 're-disposing a replaced connection must not kill again');
			assert.strictEqual(peer1.proxyHandle.disposed.value, true);
		} finally {
			disposables.dispose();
		}
	});

	test('AC8 (C1.10): the app-server child is killed before the proxy handle is released', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			const ready = await connectAgent(agent, peer) as object;

			agent['_disposeConnectionResources'](ready as never);

			assert.deepStrictEqual(peer.orderLog.filter(e => e === 'kill' || e === 'proxyDispose'), ['kill', 'proxyDispose'],
				'any subprocess holding baseUrl/nonce must be killed BEFORE its proxy handle is disposed');
			assert.deepStrictEqual(peer.killSignals, ['SIGKILL']);
			assert.strictEqual(peer.proxyHandle.disposed.value, true);
		} finally {
			disposables.dispose();
		}
	});

	test('AC1 (D16): shutdown SIGKILLs the app-server child, disposes the client, and clears runtime state', async () => {
		const disposables = new DisposableStore();
		const agent = await createAgent(disposables);
		const peer = new WirePeer(disposables);
		await connectAgent(agent, peer);
		const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
		await startTurn(peer, agent, session);
		const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
		assert.strictEqual(sessionEntry.threadId, 'thread-1');

		// Window close / host shutdown with a live connection.
		await agent.shutdown();

		assert.deepStrictEqual(peer.killSignals, ['SIGKILL'], 'the app-server child must be SIGKILLed on shutdown');
		assert.strictEqual(peer.proxyHandle.disposed.value, true, 'the proxy handle must be released on shutdown');
		assert.strictEqual(agent['_connection'].kind, 'idle');
		assert.strictEqual(agent['_sessions'].size, 0, '_sessions must be empty after shutdown');
		assert.strictEqual(agent['_sessionIdByChatUri'].size, 0, '_sessionIdByChatUri must be empty after shutdown');
		assert.strictEqual(agent['_sessionIdByThreadId'].size, 0, '_sessionIdByThreadId must be empty after shutdown');
		assert.strictEqual(agent['_activeClientHandles'].size, 0, '_activeClientHandles must be empty after shutdown');
		// A request parked on the dead client rejects instead of hanging.
		await assert.rejects(peer.client.request('getAuthStatus', { refreshToken: false, includeToken: false }));
		disposables.dispose();
	});

	test('AC16: twenty create/dispose cycles leave no retained runtime state', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			await connectAgent(agent, peer);

			for (let round = 0; round < 20; round++) {
				const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
				const chat = defaultChatOf(session);
				// Materialize (thread/start) then send nothing; dispose the chat.
				const send = agent.chats.sendMessage(chat, `round ${round}`, [URI.file('/repo')], undefined, `turn-${round}`);
				const threadStart = await peer.nextMessage();
				assert.strictEqual(threadStart.method, 'thread/start');
				peer.push({ id: threadStart.id, result: { thread: { id: `thread-${round}` } } });
				const turnStart = await peer.nextMessage();
				peer.push({ id: turnStart.id, result: {} });
				await send;
				const disposing = agent.chats.disposeChat(chat, chatContext(session, chat));
				const unsubscribe = await peer.nextMessage();
				assert.strictEqual(unsubscribe.method, 'thread/unsubscribe');
				peer.push({ id: unsubscribe.id, result: {} });
				await disposing;
			}

			assert.strictEqual(agent['_sessions'].size, 0, '_sessions must drain to empty');
			assert.strictEqual(agent['_sessionIdByChatUri'].size, 0, '_sessionIdByChatUri must drain to empty');
			assert.strictEqual(agent['_sessionIdByThreadId'].size, 0, '_sessionIdByThreadId must drain to empty');
			assert.strictEqual(agent['_activeClientHandles'].size, 0, '_activeClientHandles must drain to empty');
			assert.strictEqual(agent['_releasedManagedWorkingDirectories'].size, 0, '_releasedManagedWorkingDirectories must drain to empty');
		} finally {
			disposables.dispose();
		}
	});

	test('AC15 (B27, issue #30): mid-turn input is steered on the wire, and a concurrent send is refused before the wire instead of racing the claim', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			await connectAgent(agent, peer);
			const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
			await startTurn(peer, agent, session);
			peer.push({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'appTurn-1', items: [] } } });
			await new Promise(r => setImmediate(r));
			const chat = defaultChatOf(session);

			// Steering path: the pending message reaches the app-server as turn/steer
			// pinned to the active app turn — never silently swallowed.
			agent.setPendingMessages(chat, { id: 'steer-1', message: { text: 'also check tests' } as never }, []);
			const steered = await peer.nextMessage();
			assert.strictEqual(steered.method, 'turn/steer', 'mid-turn input must reach the wire as turn/steer');
			assert.strictEqual(steered.params.threadId, 'thread-1');
			assert.strictEqual(steered.params.expectedTurnId, 'appTurn-1');
			peer.push({ id: steered.id, result: {} });

			// Write path under contention (B27 / issue #30): a second full send
			// while a turn is active is refused BEFORE the claim — it never
			// reaches the wire (the app-server's per-thread writer lock would
			// reject it anyway, and claiming first would overwrite the active
			// turn's tracking, which the contender's failure path would then
			// clear). The refusal surfaces as an ordinary failed contender turn.
			const signals: AgentSignal[] = [];
			disposables.add(agent.onDidChatProgress(signal => signals.push(signal)));
			await agent.chats.sendMessage(chat, 'concurrent turn', [URI.file('/repo')], undefined, 'turn-2');
			assert.strictEqual(peer.pendingMessageCount, 0, 'a refused concurrent send must not reach the wire');

			const actions = actionSignals(signals);
			assert.ok(actions.some(a => a.type === ActionType.ChatError && (a as { turnId?: string }).turnId === 'turn-2'
				&& (a as { part?: { error?: { errorType?: string } } }).part?.error?.errorType === 'CodexTurnConflict'),
				'the refused concurrent turn must surface a failure');
			assert.ok(actions.some(a => a.type === ActionType.ChatTurnComplete && (a as { turnId?: string }).turnId === 'turn-2'),
				'the refused concurrent turn must be terminated');

			// The refusal must not disturb the active turn's tracking — this is
			// the regression issue #30 fixed.
			const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
			assert.strictEqual(sessionEntry.currentTurnId, 'turn-1', 'the active turn must still be tracked after the contender is refused');
			assert.strictEqual(sessionEntry.currentAppTurnId, 'appTurn-1', 'the active app-turn correlation must survive the refused contender');

			// The active turn still completes normally afterwards.
			peer.push({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'appTurn-1', items: [] } } });
			await new Promise(r => setImmediate(r));
			const allActions = actionSignals(signals);
			assert.ok(allActions.some(a => a.type === ActionType.ChatTurnComplete && (a as { turnId?: string }).turnId === 'turn-1'),
				'the active turn must still reach its terminal state after the contender is refused');
			assert.strictEqual(sessionEntry.currentTurnId, undefined, 'all turn tracking settles once both turns terminate');
		} finally {
			disposables.dispose();
		}
	});

	test('AC15b (issue #30): abort after a refused concurrent send still interrupts the tracked active turn', async () => {
		const disposables = new DisposableStore();
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			await connectAgent(agent, peer);
			const { session } = await createSession(agent, { workingDirectories: [URI.file('/repo')], model: { id: COPILOT_TEST_MODEL } });
			await startTurn(peer, agent, session);
			peer.push({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'appTurn-1', items: [] } } });
			await new Promise(r => setImmediate(r));
			const chat = defaultChatOf(session);

			// A refused contender used to clear the active turn's tracking before
			// `turn/completed` self-healed it; an abort inside that window missed
			// the active turn entirely. With the claim-side refusal the tracking
			// is never lost, so the abort must reach the wire pinned to the
			// active app turn.
			await agent.chats.sendMessage(chat, 'concurrent turn', [URI.file('/repo')], undefined, 'turn-2');
			const sessionEntry = agent['_sessions'].get(AgentSession.id(session))!;
			assert.strictEqual(sessionEntry.currentTurnId, 'turn-1', 'the refused send must not clear the active turn');
			assert.strictEqual(sessionEntry.currentAppTurnId, 'appTurn-1');

			const aborting = agent.chats.abort(chat, chatContext(session, chat));
			const interrupt = await peer.nextMessage();
			assert.strictEqual(interrupt.method, 'turn/interrupt', 'abort must interrupt the active turn even after a refused contender');
			assert.deepStrictEqual({ threadId: interrupt.params.threadId, turnId: interrupt.params.turnId }, { threadId: 'thread-1', turnId: 'appTurn-1' });
			peer.push({ id: interrupt.id, result: {} });
			await aborting;

			// The interrupted turn then terminates and tracking settles.
			peer.push({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'appTurn-1', items: [] } } });
			await new Promise(r => setImmediate(r));
			assert.strictEqual(sessionEntry.currentTurnId, undefined);
			assert.strictEqual(sessionEntry.currentAppTurnId, undefined);
		} finally {
			disposables.dispose();
		}
	});

	test('AC14 (C1.1): two peer chats of one session run concurrent turns with independent tracking', async () => {
		const disposables = new DisposableStore();
		const responder = { stop: () => { } } as { stop: () => void };
		try {
			const agent = await createAgent(disposables);
			const peer = new WirePeer(disposables);
			await connectAgent(agent, peer);
			const session = AgentSession.uri(agent.id, generateUuid());
			const defaultChat = defaultChatOf(session);
			const folder = URI.file('/repo');
			await createSession(agent, { session, workingDirectories: [folder], model: { id: COPILOT_TEST_MODEL } });
			// A peer chat whose owning session already has a backing materializes
			// immediately as its own thread (see codexCreateChat.test.ts peer topology).
			const peerChat = URI.parse(buildChatUri(session, 'peer-1'));
			const creatingPeer = agent.chats.createChat(peerChat, chatContext(session, peerChat), { workingDirectories: [folder], model: { id: COPILOT_TEST_MODEL } });
			const peerThreadStart = await peer.nextMessage();
			assert.strictEqual(peerThreadStart.method, 'thread/start');
			peer.push({ id: peerThreadStart.id, result: { thread: { id: 'peer-thread' } } });
			await creatingPeer;

			// Concurrent sends on the default chat and the peer chat. The agent
			// may restart a backing thread mid-send (tool/MCP signature refresh);
			// the responder absorbs those dances while the test watches turns.
			const auto = startAutoResponder(peer);
			responder.stop = auto.stop;
			const sendDefault = agent.chats.sendMessage(defaultChat, 'default chat prompt', [folder], undefined, 'turn-default');
			const sendPeer = agent.chats.sendMessage(peerChat, 'peer chat prompt', [folder], undefined, 'turn-peer');
			await Promise.all([sendDefault, sendPeer]);
			auto.stop();

			const turnStarts = auto.requests.filter(r => r.method === 'turn/start');
			assert.strictEqual(turnStarts.length, 2, 'each chat starts its own turn');
			assert.strictEqual(turnStarts[0].params.threadId !== turnStarts[1].params.threadId, true, 'concurrent peer turns must target distinct threads');
			for (const turn of turnStarts) {
				assert.strictEqual(agent['_sessionIdByThreadId'].has(turn.params.threadId), true, `turn thread ${turn.params.threadId} must be a tracked runtime`);
			}
		} finally {
			responder.stop();
			disposables.dispose();
		}
	});
});
