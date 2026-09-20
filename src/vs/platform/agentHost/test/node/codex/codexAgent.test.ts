/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { AgentChatMigrationDeferred, AgentSession, CODEX_AGENT_PROVIDER_ID, type AgentProvider, type IAgentChatContext, type IAgentDiscoveredChat } from '../../../common/agent.js';
import { AgentSystemNotificationKind, toAgentSystemNotificationMeta } from '../../../common/meta/agentSystemNotificationMeta.js';
import { ActionType, type ChatAction } from '../../../common/state/sessionActions.js';
import { AHP_AUTH_REQUIRED, ProtocolError } from '../../../common/state/sessionProtocol.js';
import { AgentHostGitHubMcpServerEnabledConfigKey } from '../../../common/agentHostSchema.js';
import { CustomizationEnablementKind, CustomizationType, McpServerStatus, type McpServerCustomization } from '../../../common/state/protocol/channels-session/state.js';
import { buildDefaultChatUri, parseRequiredSessionUriFromChatUri, ResponsePartKind } from '../../../common/state/sessionState.js';
import { AgentHostStateManager } from '../../../node/agentHostStateManager.js';
import { getCustomizationEnablementKey, type CustomizationEnablementResolution, type ICustomizationEnablementTarget } from '../../../node/agentHostCustomizationEnablementService.js';
import { CodexAgent, toCodexModelSelectionId } from '../../../node/codex/codexAgent.js';
import { CodexClientCustomizationStore, type ICodexClientPlugin } from '../../../node/codex/codexClientCustomizations.js';
import type { ICodexMcpServerConfigJson, ICodexMcpServerEntry } from '../../../node/codex/codexMcpServers.js';
import type { ItemGuardianApprovalReviewCompletedNotification } from '../../../node/codex/protocol/generated/v2/ItemGuardianApprovalReviewCompletedNotification.js';
import type { GuardianWarningNotification } from '../../../node/codex/protocol/generated/v2/GuardianWarningNotification.js';
import { targetForMcpServer } from '../../../node/shared/customizationEnablementGate.js';
import { McpCustomizationController, type IMcpCustomizationControllerOptions } from '../../../node/shared/mcpCustomizationController.js';
import { createGitHubMcpServerConfiguration, getGitHubMcpTools } from '../../../node/shared/githubMcpServer.js';
import { McpServerType } from '../../../../mcp/common/mcpPlatformTypes.js';

/**
 * Exactly the state `_resolveConversationSession` reads: the provider id it
 * mints canonical session URIs with, and the chat→runtime bindings it recorded.
 * Notably NOT the session map — resolution answers with the canonical URI of
 * the bound runtime id rather than echoing whatever URI an entry happens to
 * carry, so a stale or mis-stamped entry cannot redirect a chat.
 */
interface ICodexConversationResolverHarness {
	readonly id: AgentProvider;
	readonly _sessionIdByChatUri: Map<string, string>;
}

interface ICodexMcpControllerSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	readonly configurationResource: URI;
	chatChannel: URI | undefined;
	readonly clientCustomizations: CodexClientCustomizationStore;
	mcpController: McpCustomizationController | undefined;
}

interface ICodexMcpControllerHarness {
	readonly id: AgentProvider;
	readonly _instantiationService: {
		createInstance(ctor: typeof McpCustomizationController, options: IMcpCustomizationControllerOptions): McpCustomizationController;
	};
	readonly _customizationEnablementService: {
		resolve(session: string, target: ICustomizationEnablementTarget): CustomizationEnablementResolution;
	};
	readonly _emitMcpCustomizationAction: (...args: readonly unknown[]) => void;
	readonly _preferredMcpPublisher: (configurationResource: URI) => ICodexMcpControllerSession | undefined;
	readonly _switchMcpPublisher: (session: ICodexMcpControllerSession) => void;
}

interface ICodexMcpRequestHarness {
	readonly _sessionIdByChatUri: Map<string, string>;
	readonly _sessions: Map<string, { readonly chatChannel: URI | undefined; readonly threadId?: string }>;
	readonly _mcpInventory: {
		forThread(threadId: string | undefined): ReadonlyMap<string, ICodexMcpServerEntry>;
	};
}

interface ICodexGitHubMcpHarness {
	_buildSessionMcpServers(session: {
		readonly sessionId: string;
		readonly workingDirectory: URI;
	}): Record<string, ICodexMcpServerConfigJson>;
}

interface ICodexGitHubEndpointChangeHarness {
	_handleGitHubEndpointChange(): void;
}

interface ICodexBuiltInGitHubMcpHarness {
	_builtInGitHubMcpServer(session: { readonly agentMergeTurn?: boolean }, configuredServers: Record<string, ICodexMcpServerConfigJson>): Record<string, ICodexMcpServerConfigJson>;
}

interface ICodexGitHubMcpEnabledHarness {
	_githubMcpServerEnabled?: boolean;
	_isGitHubMcpServerEnabled(): boolean;
}

interface ICodexCreationModelHarness {
	_resolveCreationModel(requested: { readonly id: string } | undefined): { readonly id: string } | undefined;
}

interface ICodexImageGenerationHarness {
	_imageGenerationEnabledForModelProvider(modelProvider: string): boolean;
}

interface ICodexRestoredModelHarness {
	_modelsRefreshPromise: Promise<void> | undefined;
	refreshModels(): Promise<void>;
	_resolveRestoredModel(model: { readonly id: string } | undefined): Promise<{ readonly id: string } | undefined>;
}

interface ICodexReloadMarkingHarness {
	_markSessionForReload(session: {
		needsResume: boolean;
		unsubscribeBeforeResume: boolean;
		threadId?: string;
		hostTurnIdByAppTurnId: Map<string, string>;
		codexTurnIdByHostTurnId: Map<string, string>;
	}): void;
}

interface ICodexResumeSessionHarness {
	_resumeSession(session: Record<string, unknown>, connection?: unknown): Promise<void>;
}

interface ICodexMcpMergeHarness {
	_buildSessionMcpServers(session: {
		readonly sessionId: string;
		readonly workingDirectory: URI;
		readonly agentMergeTurn?: boolean;
	}): Record<string, ICodexMcpServerConfigJson>;
}

interface ICodexAuthenticateHarness {
	authenticate(resource: string, token: string): Promise<boolean>;
}

interface ICodexGuardianWarningHarness {
	readonly _logService: NullLogService;
}

interface ICodexGuardianWarningSession {
	readonly sessionId: string;
	readonly currentTurnId: string | undefined;
}

interface ICodexGuardianReviewSession {
	readonly sessionId: string;
	readonly sessionUri: URI;
	readonly currentTurnId: string | undefined;
	readonly hostTurnIdByAppTurnId: Map<string, string>;
	readonly handledGuardianReviews: Set<string>;
}

interface ICodexGuardianReviewHarness {
	readonly _logService: NullLogService;
	readonly _sessionIdByThreadId: Map<string, string>;
	readonly _sessions: Map<string, ICodexGuardianReviewSession>;
	_hostTurnId(session: ICodexGuardianReviewSession, appTurnId: string): string;
	_fire(sessionUri: URI, action: ChatAction): void;
}

function resolveConversationSession(harness: ICodexConversationResolverHarness, address: URI, context?: URI | IAgentChatContext): URI | undefined {
	const resolver = (CodexAgent.prototype as unknown as {
		_resolveConversationSession(this: ICodexConversationResolverHarness, address: URI, context?: URI | IAgentChatContext): URI | undefined;
	})._resolveConversationSession;
	return resolver.call(harness, address, context);
}

function getOrCreateMcpController(harness: ICodexMcpControllerHarness, session: ICodexMcpControllerSession): McpCustomizationController | undefined {
	const getOrCreate = (CodexAgent.prototype as unknown as {
		_getOrCreateMcpController(this: ICodexMcpControllerHarness, session: ICodexMcpControllerSession): McpCustomizationController | undefined;
	})._getOrCreateMcpController;
	return getOrCreate.call(harness, session);
}

function handleMcpRequest(harness: ICodexMcpRequestHarness, chat: URI): Promise<unknown> {
	const handler = (CodexAgent.prototype as unknown as {
		handleMcpRequest(this: ICodexMcpRequestHarness, chat: URI, serverName: string, method: string, params: undefined): Promise<unknown>;
	}).handleMcpRequest;
	return handler.call(harness, chat, 'server', 'tools/list', undefined);
}

function handleGuardianWarning(harness: ICodexGuardianWarningHarness, session: ICodexGuardianWarningSession, params: GuardianWarningNotification): ChatAction[] {
	const handler = (CodexAgent.prototype as unknown as {
		_handleGuardianWarning(this: ICodexGuardianWarningHarness, session: ICodexGuardianWarningSession, params: GuardianWarningNotification): ChatAction[];
	})._handleGuardianWarning;
	return handler.call(harness, session, params);
}

function handleGuardianReviewCompleted(harness: ICodexGuardianReviewHarness, params: ItemGuardianApprovalReviewCompletedNotification): Promise<void> {
	const handler = (CodexAgent.prototype as unknown as {
		_handleGuardianReviewCompleted(this: ICodexGuardianReviewHarness, client: never, params: ItemGuardianApprovalReviewCompletedNotification): Promise<void>;
	})._handleGuardianReviewCompleted;
	return handler.call(harness, undefined as never, params);
}

function emptyHarness(): ICodexConversationResolverHarness {
	return { id: CODEX_AGENT_PROVIDER_ID, _sessionIdByChatUri: new Map() };
}

suite('CodexAgent', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('ignores guardian review outcome warnings handled by structured events', () => {
		const harness: ICodexGuardianWarningHarness = { _logService: new NullLogService() };
		const session: ICodexGuardianWarningSession = { sessionId: 'session', currentTurnId: 'turn' };

		for (const message of [
			'Automatic approval review approved (risk: low, authorization: high): Safe read.',
			'Automatic approval review denied (risk: high, authorization: unknown): Unsafe action.',
			'Automatic approval review timed out while evaluating the requested approval.',
		]) {
			assert.deepStrictEqual(handleGuardianWarning(harness, session, { threadId: 'thread', message }), []);
		}
	});

	test('surfaces guardian turn-interruption warnings', () => {
		const harness: ICodexGuardianWarningHarness = { _logService: new NullLogService() };
		const session: ICodexGuardianWarningSession = { sessionId: 'session', currentTurnId: 'turn' };
		const message = 'Automatic approval review rejected too many approval requests for this turn (5 consecutive, 5 in the last 10 reviews); interrupting the turn.';

		assert.deepStrictEqual(handleGuardianWarning(harness, session, { threadId: 'thread', message }), [{
			type: ActionType.ChatResponsePart,
			turnId: 'turn',
			part: {
				kind: ResponsePartKind.SystemNotification,
				content: message,
				_meta: toAgentSystemNotificationMeta({ kind: AgentSystemNotificationKind.AutomaticApprovalReviewInterrupted }),
			},
		}]);
	});

	test('surfaces terminal guardian review failures once on their current turn', async () => {
		const actions: ChatAction[] = [];
		const session: ICodexGuardianReviewSession = {
			sessionId: 'session',
			sessionUri: URI.parse('codex:/session'),
			currentTurnId: 'host-turn',
			hostTurnIdByAppTurnId: new Map([
				['app-turn', 'host-turn'],
				['stale-app-turn', 'stale-host-turn'],
			]),
			handledGuardianReviews: new Set(),
		};
		const harness: ICodexGuardianReviewHarness = {
			_logService: new NullLogService(),
			_sessionIdByThreadId: new Map([['thread', session.sessionId]]),
			_sessions: new Map([[session.sessionId, session]]),
			_hostTurnId: (reviewSession, appTurnId) => reviewSession.hostTurnIdByAppTurnId.get(appTurnId) ?? appTurnId,
			_fire: (_sessionUri, action) => actions.push(action),
		};
		const notification = (reviewId: string, status: ItemGuardianApprovalReviewCompletedNotification['review']['status'], turnId = 'app-turn', rationale: string | null = null): ItemGuardianApprovalReviewCompletedNotification => ({
			threadId: 'thread',
			turnId,
			startedAtMs: 10,
			completedAtMs: 20,
			reviewId,
			targetItemId: null,
			decisionSource: 'agent',
			review: { status, riskLevel: null, userAuthorization: null, rationale },
			action: {
				type: 'networkAccess',
				target: 'https://example.com',
				host: 'example.com',
				protocol: 'https',
				port: 443,
			},
		});

		await handleGuardianReviewCompleted(harness, notification('approved', 'approved'));
		await handleGuardianReviewCompleted(harness, notification('in-progress', 'inProgress'));
		await handleGuardianReviewCompleted(harness, notification('stale', 'timedOut', 'stale-app-turn'));
		await handleGuardianReviewCompleted(harness, notification('timed-out', 'timedOut', 'app-turn', 'The reviewer did not respond in time.'));
		await handleGuardianReviewCompleted(harness, notification('timed-out', 'timedOut', 'app-turn', 'The reviewer did not respond in time.'));
		await handleGuardianReviewCompleted(harness, notification('aborted', 'aborted'));

		assert.deepStrictEqual({ actions, handledReviewIds: [...session.handledGuardianReviews] }, {
			actions: [
				{
					type: ActionType.ChatResponsePart,
					turnId: 'host-turn',
					part: {
						kind: ResponsePartKind.SystemNotification,
						content: 'Auto-review timed out\nRequested action: Network access `https://example.com`\n\nThe reviewer did not respond in time.',
						_meta: toAgentSystemNotificationMeta({ kind: AgentSystemNotificationKind.AutomaticApprovalReviewTimedOut }),
					},
				},
				{
					type: ActionType.ChatResponsePart,
					turnId: 'host-turn',
					part: {
						kind: ResponsePartKind.SystemNotification,
						content: 'Auto-review stopped\nRequested action: Network access `https://example.com`',
						_meta: toAgentSystemNotificationMeta({ kind: AgentSystemNotificationKind.AutomaticApprovalReviewAborted }),
					},
				},
			],
			handledReviewIds: ['timed-out', 'aborted'],
		});
	});

	test('GitHub MCP injection respects unowned server enablement', () => {
		const createHarness = (enabled: boolean, customizationEnabled: boolean, token: string | undefined): ICodexGitHubMcpHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_configurationService: { getRootValue: () => undefined },
			_sessionMcpDiscoveries: new Map(),
			_enabledClientPlugins: () => [],
			_mcpAuthTokens: new Map(),
			_githubMcpServerEnabled: enabled,
			_githubToken: token,
			_gitHubMcpServerConfiguration: token ? createGitHubMcpServerConfiguration('https://api.githubcopilot.com') : undefined,
			_isMcpServerEnabledForSdk: (_session: unknown, name: string) => name !== 'github-mcp-server' || customizationEnabled,
		});

		const enabledServers = createHarness(true, true, 'token')._buildSessionMcpServers({ sessionId: 'enabled', workingDirectory: URI.file('/work') });
		const customizationDisabledServers = createHarness(true, false, 'token')._buildSessionMcpServers({ sessionId: 'customization-disabled', workingDirectory: URI.file('/work') });
		const settingDisabledServers = createHarness(false, true, 'token')._buildSessionMcpServers({ sessionId: 'setting-disabled', workingDirectory: URI.file('/work') });
		const unauthenticatedServers = createHarness(true, true, undefined)._buildSessionMcpServers({ sessionId: 'unauthenticated', workingDirectory: URI.file('/work') });

		assert.deepStrictEqual({
			enabled: enabledServers['github-mcp-server'],
			customizationDisabled: customizationDisabledServers['github-mcp-server'],
			settingDisabled: settingDisabledServers['github-mcp-server'],
			unauthenticated: unauthenticatedServers['github-mcp-server'],
		}, {
			enabled: {
				url: 'https://api.githubcopilot.com/mcp',
				http_headers: {
					'X-MCP-Features': 'remote_mcp_ui_apps,mcp_apps_disable_form_deferral',
					'X-MCP-Tools': getGitHubMcpTools(false).join(','),
				},
			},
			customizationDisabled: undefined,
			settingDisabled: undefined,
			unauthenticated: undefined,
		});

		const aliasedServers = Object.assign(Object.create(CodexAgent.prototype), {
			_configurationService: { getRootValue: () => ({ alias: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } }) },
			_sessionMcpDiscoveries: new Map(),
			_enabledClientPlugins: () => [],
			_mcpAuthTokens: new Map(),
			_githubMcpServerEnabled: true,
			_githubToken: 'token',
			_gitHubMcpServerConfiguration: createGitHubMcpServerConfiguration('https://api.githubcopilot.com'),
			_isMcpServerEnabledForSdk: () => true,
		}) as ICodexGitHubMcpHarness;
		assert.deepStrictEqual(aliasedServers._buildSessionMcpServers({ sessionId: 'alias', workingDirectory: URI.file('/work') }), {
			alias: { url: 'https://api.githubcopilot.com/mcp/' },
		});
	});

	test('the built-in GitHub MCP server is withheld without a GitHub token (D04 AC4)', () => {
		const createHarness = (options: { enabled: boolean; token: string | undefined }): ICodexBuiltInGitHubMcpHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_githubMcpServerEnabled: options.enabled,
			_githubToken: options.token,
			_gitHubMcpServerConfiguration: options.token ? createGitHubMcpServerConfiguration('https://api.githubcopilot.com') : undefined,
			_isMcpServerEnabledForSdk: () => true,
		}) as ICodexBuiltInGitHubMcpHarness;

		// The tokenless row is the D04 regression guard: signed out of GitHub, the
		// session's `mcp_servers` must carry no built-in GitHub entry at all. The
		// merge-turn row covers agent-merge sessions, which never get the server.
		assert.deepStrictEqual({
			noToken: createHarness({ enabled: true, token: undefined })._builtInGitHubMcpServer({}, {}),
			disabled: createHarness({ enabled: false, token: 'token' })._builtInGitHubMcpServer({}, {}),
			mergeTurn: createHarness({ enabled: true, token: 'token' })._builtInGitHubMcpServer({ agentMergeTurn: true }, {}),
			enabledKeys: Object.keys(createHarness({ enabled: true, token: 'token' })._builtInGitHubMcpServer({}, {})),
		}, {
			noToken: {},
			disabled: {},
			mergeTurn: {},
			enabledKeys: ['github-mcp-server'],
		});
	});

	test('chat.agentHost.githubMcpServer.enabled=false withholds the built-in GitHub MCP server (D04 AC7)', () => {
		const createHarness = (rootValues: Record<string, unknown>): ICodexGitHubMcpEnabledHarness & ICodexBuiltInGitHubMcpHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_configurationService: { getRootValue: (_schema: unknown, key: string) => rootValues[key] },
			_githubMcpServerEnabled: undefined,
			_githubToken: 'token',
			_gitHubMcpServerConfiguration: createGitHubMcpServerConfiguration('https://api.githubcopilot.com'),
			_isMcpServerEnabledForSdk: () => true,
		}) as ICodexGitHubMcpEnabledHarness & ICodexBuiltInGitHubMcpHarness;

		const disabled = createHarness({ [AgentHostGitHubMcpServerEnabledConfigKey]: false });
		const enabled = createHarness({ [AgentHostGitHubMcpServerEnabledConfigKey]: true });
		const unset = createHarness({});

		assert.deepStrictEqual({
			disabledSetting: disabled._isGitHubMcpServerEnabled(),
			enabledSetting: enabled._isGitHubMcpServerEnabled(),
			unsetSetting: unset._isGitHubMcpServerEnabled(),
		}, {
			disabledSetting: false,
			enabledSetting: true,
			unsetSetting: true,
		});

		// End to end: the resolved flag is what gates injection, so a disabled
		// setting must yield no GitHub server even with a valid token.
		disabled._githubMcpServerEnabled = disabled._isGitHubMcpServerEnabled();
		enabled._githubMcpServerEnabled = enabled._isGitHubMcpServerEnabled();
		assert.deepStrictEqual({
			disabled: disabled._builtInGitHubMcpServer({}, {}),
			enabledKeys: Object.keys(enabled._builtInGitHubMcpServer({}, {})),
		}, {
			disabled: {},
			enabledKeys: ['github-mcp-server'],
		});
	});

	test('model resolution without a GitHub token falls back to the OpenAI provider and only Copilot models require GitHub (D04 B9)', () => {
		const openAIModel = { id: toCodexModelSelectionId('openai', 'gpt-5-codex'), name: 'GPT-5 Codex', provider: 'codex', supportsVision: false };
		const copilotModel = { id: toCodexModelSelectionId('vscode-proxy', 'gpt-5'), name: 'GPT-5', provider: 'codex', supportsVision: false };
		const createHarness = (models: readonly typeof openAIModel[], token: string | undefined): ICodexCreationModelHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_models: observableValue('models', models),
			_logService: new NullLogService(),
			_githubToken: token,
			// D05: no default-provider flag and no OpenAI credential — the legacy
			// Copilot-first default-provider policy applies.
			_configurationService: { getRootValue: () => undefined },
			_openAIAccountState: { usageSource: 'openai', status: 'signedOut' },
			_gitHubEndpointService: {
				getCopilotResource: () => ({ resource: 'https://api.github.com/copilot_internal/user' }),
				getRepoResource: () => ({ resource: 'https://api.github.com' }),
			},
		}) as ICodexCreationModelHarness;

		// No explicit selection + OpenAI-backed catalog: the default resolves to the
		// OpenAI model and no GitHub authentication is demanded.
		assert.deepStrictEqual(createHarness([openAIModel], undefined)._resolveCreationModel(undefined), { id: openAIModel.id });

		// An explicit OpenAI selection never needs a GitHub token either.
		assert.deepStrictEqual(createHarness([openAIModel, copilotModel], undefined)._resolveCreationModel({ id: openAIModel.id }), { id: openAIModel.id });

		// A Copilot-routed model without a token rejects with the structured
		// AHP_AUTH_REQUIRED the client turns into a sign-in prompt — never an
		// uncaught failure.
		const copilotOnly = createHarness([copilotModel], undefined);
		assert.throws(
			() => copilotOnly._resolveCreationModel(undefined),
			(error: unknown) => error instanceof ProtocolError && error.code === AHP_AUTH_REQUIRED,
		);

		// With a token the same Copilot default resolves fine.
		assert.deepStrictEqual(createHarness([copilotModel], 'token')._resolveCreationModel(undefined), { id: copilotModel.id });
	});

	test('default provider policy prefers OpenAI credentials and falls back to Copilot only without them (D05 #7 / AC1)', () => {
		const openAIModel = { id: toCodexModelSelectionId('openai', 'gpt-5-codex'), name: 'GPT-5 Codex', provider: 'codex', supportsVision: false };
		const openAIModel2 = { id: toCodexModelSelectionId('openai', 'gpt-5'), name: 'GPT-5', provider: 'codex', supportsVision: false };
		const copilotModel = { id: toCodexModelSelectionId('vscode-proxy', 'gpt-5'), name: 'GPT-5 (Copilot)', provider: 'codex', supportsVision: false };
		const createHarness = (
			models: readonly typeof openAIModel[],
			token: string | undefined,
			accountState: { readonly status: string; readonly authType?: string },
			preferOpenAI: boolean,
		): ICodexCreationModelHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_models: observableValue('models', models),
			_logService: new NullLogService(),
			_githubToken: token,
			_configurationService: { getRootValue: (_schema: unknown, key: string) => key === 'codexPreferOpenAIProvider' ? preferOpenAI : undefined },
			_openAIAccountState: { usageSource: 'openai', ...accountState },
			_gitHubEndpointService: {
				getCopilotResource: () => ({ resource: 'https://api.github.com/copilot_internal/user' }),
				getRepoResource: () => ({ resource: 'https://api.github.com' }),
			},
		}) as ICodexCreationModelHarness;

		// OpenAI credential present (ChatGPT subscription): the default jumps the
		// Copilot-first catalog order and picks the first OpenAI-native model.
		assert.deepStrictEqual(
			createHarness([copilotModel, openAIModel, openAIModel2], 'token', { status: 'signedIn', authType: 'chatgpt' }, true)._resolveCreationModel(undefined),
			{ id: openAIModel.id },
		);

		// OpenAI credential present (API key): same policy, and no GitHub token is
		// demanded for the OpenAI default (B9 core).
		assert.deepStrictEqual(
			createHarness([openAIModel], undefined, { status: 'signedIn', authType: 'apiKey' }, true)._resolveCreationModel(undefined),
			{ id: openAIModel.id },
		);

		// No OpenAI credential but a GitHub token: the default falls back to the
		// Copilot proxy provider.
		assert.deepStrictEqual(
			createHarness([copilotModel, openAIModel], 'token', { status: 'signedOut' }, true)._resolveCreationModel(undefined),
			{ id: copilotModel.id },
		);

		// Neither credential: the legacy guidance stands — a Copilot-routed
		// default still raises the structured sign-in prompt.
		const noCredentials = createHarness([copilotModel], undefined, { status: 'signedOut' }, true);
		assert.throws(
			() => noCredentials._resolveCreationModel(undefined),
			(error: unknown) => error instanceof ProtocolError && error.code === AHP_AUTH_REQUIRED,
		);

		// Rollback lever: with the policy flag off the Copilot-first default is
		// restored even for a signed-in OpenAI account.
		assert.deepStrictEqual(
			createHarness([copilotModel, openAIModel], 'token', { status: 'signedIn', authType: 'chatgpt' }, false)._resolveCreationModel(undefined),
			{ id: copilotModel.id },
		);

		// A signed-in OpenAI account with an empty catalog is not asked for a
		// GitHub token: the no-selection fallback provider is the OpenAI provider.
		assert.deepStrictEqual(
			createHarness([], undefined, { status: 'signedIn', authType: 'chatgpt' }, true)._resolveCreationModel(undefined),
			undefined,
		);

		// The same empty catalog without any credential keeps the legacy gate.
		const emptyLegacy = createHarness([], undefined, { status: 'signedOut' }, false);
		assert.throws(
			() => emptyLegacy._resolveCreationModel(undefined),
			(error: unknown) => error instanceof ProtocolError && error.code === AHP_AUTH_REQUIRED,
		);
	});

	test('image generation is gated to the OpenAI provider with a ChatGPT subscription (D05 #7 / AC9)', () => {
		const createHarness = (status: string, authType?: string): ICodexImageGenerationHarness =>
			Object.assign(Object.create(CodexAgent.prototype), {
				_openAIAccountState: { usageSource: 'openai', status, authType },
			}) as ICodexImageGenerationHarness;

		const results: Record<string, boolean> = {};
		for (const provider of ['openai', 'vscode-proxy', 'custom-provider']) {
			for (const status of ['signedIn', 'signedOut', 'unknown', 'unavailable', 'error']) {
				for (const authType of ['chatgpt', 'apiKey', 'other', undefined]) {
					results[`${provider}/${status}/${authType ?? 'none'}`] = createHarness(status, authType)._imageGenerationEnabledForModelProvider(provider);
				}
			}
		}
		const enabled = Object.entries(results).filter(([, value]) => value).map(([key]) => key);
		assert.deepStrictEqual(enabled, ['openai/signedIn/chatgpt']);
	});

	test('restored model resolution waits for discovery, stays on the same provider, and keeps history-only models (D05 #7 / AC5)', async () => {
		const storedOpenAI = { id: toCodexModelSelectionId('openai', 'gpt-5-codex') };
		const fallbackOpenAI = { id: toCodexModelSelectionId('openai', 'gpt-5.1-codex'), name: 'GPT-5.1 Codex', provider: 'codex', supportsVision: false };
		const secondOpenAI = { id: toCodexModelSelectionId('openai', 'gpt-5'), name: 'GPT-5', provider: 'codex', supportsVision: false };
		const copilotModel = { id: toCodexModelSelectionId('vscode-proxy', 'gpt-5'), name: 'GPT-5 (Copilot)', provider: 'codex', supportsVision: false };

		const createHarness = (models: readonly typeof fallbackOpenAI[]): ICodexRestoredModelHarness => Object.assign(Object.create(CodexAgent.prototype), {
			_models: observableValue('models', models),
			_modelsRefreshPromise: undefined,
			_logService: new NullLogService(),
			_configurationService: { getRootValue: () => undefined },
			_openAIAccountState: { usageSource: 'openai', status: 'signedOut' },
			refreshModels: async () => { },
		}) as ICodexRestoredModelHarness;

		// A5.3: a stored model still in the catalog is preserved verbatim.
		assert.deepStrictEqual(await createHarness([fallbackOpenAI])._resolveRestoredModel({ id: fallbackOpenAI.id }), { id: fallbackOpenAI.id });

		// A5.4: a stored model missing from the catalog waits for the queued
		// refresh, then falls back to the FIRST available model of the SAME
		// provider.
		const harness = createHarness([]);
		harness._modelsRefreshPromise = Promise.resolve().then(() => {
			(harness as unknown as { _models: { set(value: readonly unknown[], tx?: unknown): void } })._models.set([fallbackOpenAI, secondOpenAI, copilotModel]);
			harness._modelsRefreshPromise = undefined;
		});
		assert.deepStrictEqual(await harness._resolveRestoredModel(storedOpenAI), { id: fallbackOpenAI.id });

		// A5.5 + A5.6: with no model left on the stored provider the selection is
		// kept (so the history stays readable) instead of silently crossing the
		// billing boundary onto another provider's model.
		assert.deepStrictEqual(await createHarness([copilotModel])._resolveRestoredModel(storedOpenAI), storedOpenAI);
	});

	test('session MCP servers merge root config, workspace discovery, and client plugins with later layers winning (D05 #7 / AC8)', () => {
		const session = { sessionId: 'session-1', workingDirectory: URI.file('/repo'), agentMergeTurn: false };
		const http = (url: string) => ({ type: McpServerType.REMOTE, url });
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_configurationService: {
				getRootValue: (_schema: unknown, key: string) => key === 'mcpServers' ? {
					shared: http('https://root.example/shared'),
					'root-only': http('https://root.example/root-only'),
				} : undefined,
			},
			_isMcpServerEnabledForSdk: () => true,
			_sessionMcpDiscoveries: new Map([[session.sessionId, {
				discovery: {
					definitions: [
						{ name: 'shared', configuration: http('https://workspace.example/shared') },
						{ name: 'workspace-only', configuration: http('https://workspace.example/workspace-only') },
					],
				},
			}]]),
			_enabledClientPlugins: () => [{
				synced: { customization: { id: 'plugin', uri: 'file:///plugin' } },
				parsed: {
					mcpServers: [
						{ name: 'shared', configuration: http('https://plugin.example/shared') },
						{ name: 'plugin-only', configuration: http('https://plugin.example/plugin-only') },
					],
				},
			}],
			_builtInGitHubMcpServer: () => ({}),
			_mcpAuthTokens: new Map<string, string>(),
		}) as ICodexMcpMergeHarness;

		// AC8: on a name collision the client plugin wins over workspace
		// discovery, which wins over the root configuration.
		assert.deepStrictEqual(harness._buildSessionMcpServers(session), {
			shared: { url: 'https://plugin.example/shared' },
			'root-only': { url: 'https://root.example/root-only' },
			'workspace-only': { url: 'https://workspace.example/workspace-only' },
			'plugin-only': { url: 'https://plugin.example/plugin-only' },
		});
	});

	test('reload marking keeps the thread and turn-id mappings intact for the next send (D05 #7 / AC6)', () => {
		const session = {
			needsResume: false,
			unsubscribeBeforeResume: false,
			threadId: 'thread-1',
			hostTurnIdByAppTurnId: new Map([['app-1', 'host-1']]),
			codexTurnIdByHostTurnId: new Map([['host-1', 'codex-1']]),
		};
		(CodexAgent.prototype as unknown as ICodexReloadMarkingHarness)._markSessionForReload.call({} as ICodexReloadMarkingHarness, session);

		// A provider/model switch defers the reload to the next send on the SAME
		// thread: the thread id and both turn-id mappings survive untouched.
		assert.deepStrictEqual(session, {
			needsResume: true,
			unsubscribeBeforeResume: true,
			threadId: 'thread-1',
			hostTurnIdByAppTurnId: new Map([['app-1', 'host-1']]),
			codexTurnIdByHostTurnId: new Map([['host-1', 'codex-1']]),
		});
	});

	suite('resume provider switch (D05 #7 / AC6 + AC7)', () => {
		const copilotModel = { id: toCodexModelSelectionId('vscode-proxy', 'gpt-5'), name: 'GPT-5 (Copilot)', provider: 'codex', supportsVision: false };

		function createResumeFixture(materializedModelProvider: string) {
			const requests: { method: string; params: Record<string, unknown> }[] = [];
			const client = {
				request: async (method: string, params: Record<string, unknown>) => {
					requests.push({ method, params });
					return {};
				},
			};
			const conn = { kind: 'ready', client };
			const session = {
				sessionId: 'session-1',
				sessionUri: URI.parse('codex:/session-1'),
				configurationResource: URI.parse('codex:/session-1'),
				workingDirectory: URI.file('/repo'),
				workingDirectories: undefined,
				multiRootEnabled: false,
				threadId: 'thread-1',
				disposed: false,
				needsResume: true,
				unsubscribeBeforeResume: true,
				resumePromise: undefined,
				hasNativeHistory: true,
				firstTurnSent: true,
				agentMergeTurn: false,
				model: { id: copilotModel.id },
				materializedModelProvider,
				pendingModelProviderSwitch: undefined,
				materializedMcpSig: undefined,
				materializedCustomizationsSig: undefined,
				materializedHookTrustSig: undefined,
				hostTurnIdByAppTurnId: new Map([['app-1', 'host-1']]),
				codexTurnIdByHostTurnId: new Map([['host-1', 'codex-1']]),
			};
			const harness = Object.assign(Object.create(CodexAgent.prototype), {
				_connection: conn,
				_logService: new NullLogService(),
				_models: observableValue('models', [copilotModel]),
				_modelsRefreshPromise: undefined,
				_configurationService: { getRootValue: () => undefined, getSessionConfigValues: () => ({}) },
				_openAIAccountState: { usageSource: 'openai', status: 'signedIn', authType: 'apiKey' },
				_refreshSessionMcpDiscovery: async () => { },
				_buildSessionMcpServers: () => ({}),
				_buildCustomizationLaunch: async () => ({ config: {}, developerInstructions: undefined, selectedCapabilityRoots: [], signature: 'sig' }),
				_ensurePortableProxyConfiguration: async () => { },
				_buildSessionHookTrustState: async () => ({ grants: {}, contextSignature: '' }),
				_tryBuildSessionHookTrustState: async () => undefined,
				_isCurrentSessionHookTrustState: () => true,
				_applySessionHookTrustState: () => { },
				_refreshMcpInventory: async () => { },
				_traceContext: () => undefined,
			}) as unknown as ICodexResumeSessionHarness;
			return { harness, session, requests, conn };
		}

		test('unsubscribes before resuming the same thread, keeps turn-id maps, and records the switch', async () => {
			const { harness, session, requests, conn } = createResumeFixture('openai');

			await harness._resumeSession(session as unknown as Record<string, unknown>, conn);

			// thread/unsubscribe strictly precedes thread/resume so app-server
			// reloads the persisted history with the current launch-only config.
			assert.deepStrictEqual(requests.map(r => r.method), ['thread/unsubscribe', 'thread/resume']);
			// Same thread: the id is never reassigned and both turn-id mappings
			// survive the reload.
			assert.strictEqual(session.threadId, 'thread-1');
			assert.deepStrictEqual(session.hostTurnIdByAppTurnId, new Map([['app-1', 'host-1']]));
			assert.deepStrictEqual(session.codexTurnIdByHostTurnId, new Map([['host-1', 'codex-1']]));
			// The switch is recorded so the NEXT accepted turn/start on this
			// thread — and only that — can count it (AC7).
			assert.deepStrictEqual(session.pendingModelProviderSwitch, { threadId: 'thread-1', fromProvider: 'openai' });
			assert.strictEqual(session.materializedModelProvider, 'vscode-proxy');
			const resumeParams = requests[1].params as { threadId?: string; model?: string; modelProvider?: string; approvalPolicy?: string; approvalsReviewer?: string; permissions?: string; config?: Record<string, unknown> };
			assert.strictEqual(resumeParams.threadId, 'thread-1');
			// A5.6: thread/resume params carry the model AND its provider.
			assert.strictEqual(resumeParams.model, 'gpt-5');
			assert.strictEqual(resumeParams.modelProvider, 'vscode-proxy');
			// Decision 3: the default preset keeps a human approver.
			assert.strictEqual(resumeParams.approvalsReviewer, 'user');
			// Decision 2: workspace-write sessions launch on the workspace profile.
			assert.strictEqual(resumeParams.permissions, 'vscode-workspace');
			// Decision 4 / AC9: image generation stays off for the Copilot provider.
			assert.strictEqual(resumeParams.config?.['features.image_generation'], false);
		});

		test('resume within the same provider records no switch (AC7)', async () => {
			const { harness, session, requests, conn } = createResumeFixture('vscode-proxy');

			await harness._resumeSession(session as unknown as Record<string, unknown>, conn);

			assert.deepStrictEqual(requests.map(r => r.method), ['thread/unsubscribe', 'thread/resume']);
			assert.strictEqual(session.pendingModelProviderSwitch, undefined);
			assert.strictEqual(session.materializedModelProvider, 'vscode-proxy');
		});
	});

	test('clears GitHub MCP credentials when the GitHub endpoint changes', () => {
		const proxyTokens: string[] = [];
		let modelRefreshes = 0;
		let reconciliations = 0;
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_githubToken: 'token',
			_gitHubMcpServerConfiguration: createGitHubMcpServerConfiguration('https://api.enterprise.githubcopilot.com'),
			_connection: { kind: 'ready', proxyHandle: { setToken: (token: string) => proxyTokens.push(token) } },
			_queueModelRefresh: () => { modelRefreshes++; },
			_sessions: new Map([['session', {}]]),
			_reconcileMaterializedCustomizations: async () => { reconciliations++; },
		}) as ICodexGitHubEndpointChangeHarness & { _githubToken?: string; _gitHubMcpServerConfiguration?: object };

		harness._handleGitHubEndpointChange();

		assert.deepStrictEqual({
			token: harness._githubToken,
			configuration: harness._gitHubMcpServerConfiguration,
			proxyTokens,
			modelRefreshes,
			reconciliations,
		}, {
			token: undefined,
			configuration: undefined,
			proxyTokens: [''],
			modelRefreshes: 1,
			reconciliations: 1,
		});
	});

	test('does not commit stale GitHub authentication after an endpoint change', async () => {
		const resolution = new DeferredPromise<ReturnType<typeof createGitHubMcpServerConfiguration>>();
		const proxyTokens: string[] = [];
		let reconciliations = 0;
		const copilotResource = { resource: 'https://api.github.com/copilot_internal/user' };
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_gitHubEndpointService: { getCopilotResource: () => copilotResource, getRepoResource: () => ({ resource: 'https://api.github.com' }) },
			_githubAuthenticationGeneration: 0,
			_githubToken: undefined,
			_gitHubMcpServerConfiguration: undefined,
			_resolveGitHubMcpServerConfiguration: async () => resolution.p,
			_connection: { kind: 'ready', proxyHandle: { setToken: (token: string) => proxyTokens.push(token) } },
			_queueModelRefresh: () => { },
			_sessions: new Map([['session', {}]]),
			_reconcileMaterializedCustomizations: async () => { reconciliations++; },
			_logService: new NullLogService(),
			_refreshProviderConfiguration: async () => { },
		}) as ICodexAuthenticateHarness & ICodexGitHubEndpointChangeHarness & { _githubToken?: string; _gitHubMcpServerConfiguration?: object };

		const authenticating = harness.authenticate(copilotResource.resource, 'old-token');
		harness._handleGitHubEndpointChange();
		resolution.complete(createGitHubMcpServerConfiguration('https://api.enterprise.githubcopilot.com'));
		await authenticating;

		assert.deepStrictEqual({
			token: harness._githubToken,
			configuration: harness._gitHubMcpServerConfiguration,
			proxyTokens,
			reconciliations,
		}, {
			token: undefined,
			configuration: undefined,
			proxyTokens: [''],
			reconciliations: 1,
		});
	});

	test('restarts a proxy-less app-server connection when a GitHub token arrives (Issue #39)', async () => {
		const copilotResource = { resource: 'https://api.github.com/copilot_internal/user' };
		const proxyTokens: string[] = [];
		const lostConnections: unknown[] = [];
		let modelRefreshes = 0;
		const proxyLessConnection = { kind: 'ready', proxyHandle: undefined };
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_gitHubEndpointService: { getCopilotResource: () => copilotResource, getRepoResource: () => ({ resource: 'https://api.github.com' }) },
			_githubAuthenticationGeneration: 0,
			_githubToken: undefined,
			_gitHubMcpServerConfiguration: undefined,
			_resolveGitHubMcpServerConfiguration: async () => undefined,
			_connection: proxyLessConnection,
			_queueModelRefresh: () => { modelRefreshes++; },
			_sessions: new Map(),
			_reconcileMaterializedCustomizations: async () => { },
			_logService: new NullLogService(),
			_refreshProviderConfiguration: async () => { },
			_handleConnectionLost: (connection: unknown) => { lostConnections.push(connection); },
		}) as ICodexAuthenticateHarness & { _githubToken?: string };

		const result = await harness.authenticate(copilotResource.resource, 'new-token');

		assert.strictEqual(result, true);
		assert.strictEqual(harness._githubToken, 'new-token');
		assert.deepStrictEqual(proxyTokens, [], 'there is no proxy to hot-update');
		assert.deepStrictEqual(lostConnections, [proxyLessConnection], 'the proxy-less connection is bounced so the replacement spawns with the proxy');
		assert.strictEqual(modelRefreshes, 1);
	});

	test('hot-updates the proxy token in place when the connection already has a proxy (Issue #39)', async () => {
		const copilotResource = { resource: 'https://api.github.com/copilot_internal/user' };
		const proxyTokens: string[] = [];
		const lostConnections: unknown[] = [];
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_gitHubEndpointService: { getCopilotResource: () => copilotResource, getRepoResource: () => ({ resource: 'https://api.github.com' }) },
			_githubAuthenticationGeneration: 0,
			_githubToken: 'old-token',
			_gitHubMcpServerConfiguration: undefined,
			_resolveGitHubMcpServerConfiguration: async () => undefined,
			_connection: { kind: 'ready', proxyHandle: { setToken: (token: string) => proxyTokens.push(token) } },
			_queueModelRefresh: () => { },
			_sessions: new Map(),
			_reconcileMaterializedCustomizations: async () => { },
			_logService: new NullLogService(),
			_refreshProviderConfiguration: async () => { },
			_handleConnectionLost: (connection: unknown) => { lostConnections.push(connection); },
		}) as ICodexAuthenticateHarness & { _githubToken?: string };

		const result = await harness.authenticate(copilotResource.resource, 'new-token');

		assert.strictEqual(result, true);
		assert.deepStrictEqual(proxyTokens, ['new-token'], 'an existing proxy keeps the in-place token rotation');
		assert.deepStrictEqual(lostConnections, [], 'a proxy-backed connection is not bounced');
	});

	test('does not bounce anything when a GitHub token arrives while the connection is idle (Issue #39)', async () => {
		const copilotResource = { resource: 'https://api.github.com/copilot_internal/user' };
		const lostConnections: unknown[] = [];
		const harness = Object.assign(Object.create(CodexAgent.prototype), {
			_gitHubEndpointService: { getCopilotResource: () => copilotResource, getRepoResource: () => ({ resource: 'https://api.github.com' }) },
			_githubAuthenticationGeneration: 0,
			_githubToken: undefined,
			_gitHubMcpServerConfiguration: undefined,
			_resolveGitHubMcpServerConfiguration: async () => undefined,
			_connection: { kind: 'idle' },
			_queueModelRefresh: () => { },
			_sessions: new Map(),
			_reconcileMaterializedCustomizations: async () => { },
			_logService: new NullLogService(),
			_refreshProviderConfiguration: async () => { },
			_handleConnectionLost: (connection: unknown) => { lostConnections.push(connection); },
		}) as ICodexAuthenticateHarness & { _githubToken?: string };

		const result = await harness.authenticate(copilotResource.resource, 'new-token');

		assert.strictEqual(result, true);
		assert.deepStrictEqual(lostConnections, [], 'an idle connection needs no bounce — the next spawn sees the token');
	});

	test('does not treat a transient host configuration scope as a chat backing', () => {
		const session = AgentSession.uri('codex', 'session-1');

		const result = resolveConversationSession(emptyHarness(), URI.parse('untitled:conversation'), {
			resource: URI.parse('untitled:conversation'),
			configurationResource: session,
		});

		assert.strictEqual(result, undefined);
	});

	test('resolves a bound conversation URI from the recorded session binding', () => {
		const session = AgentSession.uri('codex', 'session-2');
		const chat = URI.parse('untitled:bound');
		const harness: ICodexConversationResolverHarness = {
			id: CODEX_AGENT_PROVIDER_ID,
			_sessionIdByChatUri: new Map([[chat.toString(), 'session-2']]),
		};

		const result = resolveConversationSession(harness, chat);

		assert.strictEqual(result?.toString(), session.toString());
	});

	test('resolution uses only a recorded binding', () => {
		const session = AgentSession.uri('codex', 'session-3');
		const defaultChat = URI.parse(buildDefaultChatUri(session));

		assert.deepStrictEqual({
			// The legacy "a codex session URI addresses its own chat" adapter is
			// gone: an unbound session URI is not self-resolving any more.
			unboundSessionUri: resolveConversationSession(emptyHarness(), session)?.toString(),
			// Nor is a chat URI recognized by shape or by the configuration scope
			// supplied in host context. That scope does not identify a peer's
			// independent backing thread.
			unboundDefaultChat: resolveConversationSession(emptyHarness(), defaultChat)?.toString(),
			withHostContext: resolveConversationSession(emptyHarness(), defaultChat, { configurationResource: session, resource: defaultChat })?.toString(),
			foreignUri: resolveConversationSession(emptyHarness(), URI.parse('untitled:unknown'))?.toString(),
		}, {
			unboundSessionUri: undefined,
			unboundDefaultChat: undefined,
			withHostContext: undefined,
			foreignUri: undefined,
		});
	});

	test('creates MCP customization state only after a concrete chat is bound', () => {
		const store = new DisposableStore();
		const stateManager = store.add(new AgentHostStateManager(new NullLogService()));
		const customizations = new CodexClientCustomizationStore();
		const session: ICodexMcpControllerSession = {
			sessionId: 'session-1',
			sessionUri: AgentSession.uri('codex', 'session-1'),
			configurationResource: AgentSession.uri('codex', 'session-1'),
			chatChannel: undefined,
			clientCustomizations: customizations,
			mcpController: undefined,
		};
		const pluginUri = 'file:///plugins/azure';
		const harness: ICodexMcpControllerHarness = {
			id: CODEX_AGENT_PROVIDER_ID,
			_instantiationService: {
				createInstance: (_ctor, options) => store.add(new McpCustomizationController(options, stateManager)),
			},
			_customizationEnablementService: {
				resolve: (_session, target) => ({
					kind: 'resolved',
					enablement: target.owningPluginSource?.toString() === pluginUri
						? [{ kind: CustomizationEnablementKind.Global, enabled: false }]
						: [],
					enabled: false,
					workingDirectory: { kind: 'workspaceless' },
				}),
			},
			_emitMcpCustomizationAction: () => { },
			_preferredMcpPublisher: () => session,
			_switchMcpPublisher: () => { },
		};
		const beforeChatBinding = getOrCreateMcpController(harness, session);
		session.chatChannel = URI.parse(buildDefaultChatUri(session.sessionUri));
		const controller = getOrCreateMcpController(harness, session);
		assert.ok(controller);
		const plugin = {
			synced: { customization: { id: 'azure-plugin', uri: pluginUri } },
			parsed: { mcpServers: [{ name: 'azure' }] },
		} as unknown as ICodexClientPlugin;

		customizations.setClient('client', [plugin]);
		customizations.setEnabled('azure-plugin', false);

		const topLevel: McpServerCustomization = {
			type: CustomizationType.McpServer,
			id: 'mcp-top-level:codex:session-1:azure',
			uri: 'mcp-top-level:codex:session-1:azure',
			name: 'azure',
			state: { kind: McpServerStatus.Starting },
		};
		const nested: McpServerCustomization = {
			...topLevel,
			id: 'mcp-child:azure',
			uri: `${pluginUri}/.mcp.json`,
		};
		const owner = controller.pluginMcpServerSources?.get('azure');
		controller.applyOne({ name: 'azure', state: { kind: McpServerStatus.Starting } });
		const topLevelEnablement = controller.topLevelCustomizations()[0]?.enablement;

		assert.deepStrictEqual({
			beforeChatBinding,
			owner,
			topLevelKey: getCustomizationEnablementKey(targetForMcpServer(topLevel, owner, false), CustomizationEnablementKind.Global),
			nestedKey: getCustomizationEnablementKey(targetForMcpServer(nested, pluginUri, false), CustomizationEnablementKind.Global),
			topLevelEnablement,
		}, {
			beforeChatBinding: undefined,
			owner: pluginUri,
			topLevelKey: `${pluginUri}#mcp=azure`,
			nestedKey: `${pluginUri}#mcp=azure`,
			topLevelEnablement: [{ kind: CustomizationEnablementKind.Global, enabled: false }],
		});

		store.dispose();
	});

	test('routes MCP requests only to the exact bound chat', async () => {
		const session = AgentSession.uri('codex', 'session-1');
		const boundChat = URI.parse(buildDefaultChatUri(session));
		const staleChat = URI.parse(buildDefaultChatUri(AgentSession.uri('codex', 'stale')));
		const harness: ICodexMcpRequestHarness = {
			_sessionIdByChatUri: new Map([
				[boundChat.toString(), 'session-1'],
				[staleChat.toString(), 'session-1'],
			]),
			_sessions: new Map([['session-1', { chatChannel: boundChat }]]),
			_mcpInventory: {
				forThread: () => new Map([['server', {
					state: { kind: McpServerStatus.Ready },
					tools: [],
					resources: [],
					resourceTemplates: [],
				}]]),
			},
		};

		assert.deepStrictEqual({
			result: await handleMcpRequest(harness, boundChat),
			staleRejected: await handleMcpRequest(harness, staleChat).then(
				() => false,
				error => error instanceof Error && error.message.startsWith('Method not found: no active chat'),
			),
		}, {
			result: { tools: [] },
			staleRejected: true,
		});
	});

	test('cold native discovery waits for the SDK rather than fetching it, and runs again once it lands', async () => {
		const onDidDiscoverChats = new Emitter<readonly IAgentDiscoveredChat[]>();
		const discoveredChats: number[] = [];
		const listener = onDidDiscoverChats.event(chats => discoveredChats.push(chats.length));
		type DiscoveryHarness = {
			_activated: boolean;
			_isShuttingDown: boolean;
			_store: { isDisposed: boolean };
			_codexChatDiscovery: Promise<void> | undefined;
			_isSdkResolvableWithoutDownload(): Promise<boolean>;
			_emitCodexChats(): Promise<boolean>;
			_startCodexChatDiscovery(): Promise<void>;
			_logService: { warn(message: string): void; info(message: string): void };
		};
		const discovery = CodexAgent.prototype as unknown as {
			_startCodexChatDiscovery(this: DiscoveryHarness): Promise<void>;
			_restartChatDiscovery(this: DiscoveryHarness): void;
		};
		let sdkIsLocal = false;
		const harness: DiscoveryHarness = {
			_activated: true,
			_isShuttingDown: false,
			_store: { isDisposed: false },
			_logService: { warn: () => { }, info: () => { } },
			_codexChatDiscovery: undefined,
			_isSdkResolvableWithoutDownload: async () => sdkIsLocal,
			_startCodexChatDiscovery: () => discovery._startCodexChatDiscovery.call(harness),
			_emitCodexChats: async () => {
				onDidDiscoverChats.fire([{
					chat: URI.parse('agenthost-chat://codex/session/default'),
					startTime: 1,
					modifiedTime: 1,
					external: true,
				}]);
				return true;
			},
		};

		await discovery._startCodexChatDiscovery.call(harness);
		const cold = [...discoveredChats];

		// What the explicit download does on its way out.
		sdkIsLocal = true;
		discovery._restartChatDiscovery.call(harness);
		await harness._codexChatDiscovery;

		assert.deepStrictEqual({ cold, after: discoveredChats }, { cold: [], after: [1] });
		listener.dispose();
		onDidDiscoverChats.dispose();
	});

	test('listChatsToMigrate returns only known Codex chats without provenance', async () => {
		const knownInternal = AgentSession.uri('codex', 'known-internal');
		const knownExternal = AgentSession.uri('codex', 'known-external');
		const unknownExternal = AgentSession.uri('codex', 'unknown-external');
		const chats = [
			{ chat: URI.parse(buildDefaultChatUri(knownInternal)), startTime: 1, modifiedTime: 2 },
			{ chat: URI.parse(buildDefaultChatUri(knownExternal)), startTime: 3, modifiedTime: 4 },
			{ chat: URI.parse(buildDefaultChatUri(unknownExternal)), startTime: 5, modifiedTime: 6 },
		];
		const listChatsToMigrate = (CodexAgent.prototype as unknown as {
			listChatsToMigrate(this: {
				_activated: boolean;
				_isSdkResolvableWithoutDownload(): Promise<boolean>;
				_listCodexChats(): Promise<typeof chats | undefined>;
				_isKnownCodexChat(chat: (typeof chats)[number]): Promise<boolean>;
				_logService: { info(message: string): void };
			}): Promise<typeof chats | undefined | typeof AgentChatMigrationDeferred>;
		}).listChatsToMigrate;
		// Deferred while the SDK is absent: the catalog it reads lives inside one,
		// and fetching it is the user's call.
		let sdkIsLocal = false;
		const harness = {
			_activated: true,
			_logService: { info: () => { } },
			_isSdkResolvableWithoutDownload: async () => sdkIsLocal,
			_listCodexChats: async () => chats,
			_isKnownCodexChat: async (chat: (typeof chats)[number]) => {
				const id = AgentSession.id(URI.parse(parseRequiredSessionUriFromChatUri(chat.chat)));
				return id !== 'unknown-external';
			},
		};

		const inactive = await listChatsToMigrate.call({ ...harness, _activated: false });
		const cold = await listChatsToMigrate.call(harness);
		sdkIsLocal = true;
		const result = await listChatsToMigrate.call(harness);
		const empty = await listChatsToMigrate.call({ ...harness, _listCodexChats: async () => [], _isKnownCodexChat: async () => false });
		const unavailable = await listChatsToMigrate.call({ ...harness, _listCodexChats: async () => undefined });

		assert.deepStrictEqual({ inactive, cold, result, empty, unavailable }, {
			inactive: AgentChatMigrationDeferred,
			cold: AgentChatMigrationDeferred,
			result: chats.slice(0, 2),
			empty: [],
			unavailable: undefined,
		});
	});

	test('activated discovery classifies known Codex chats as internal and unknown chats as external', async () => {
		const knownInternal = AgentSession.uri('codex', 'known-internal');
		const knownExternal = AgentSession.uri('codex', 'known-external');
		const unknownExternal = AgentSession.uri('codex', 'unknown-external');
		const chats = [
			{ chat: URI.parse(buildDefaultChatUri(knownInternal)), startTime: 1, modifiedTime: 2 },
			{ chat: URI.parse(buildDefaultChatUri(knownExternal)), startTime: 3, modifiedTime: 4 },
			{ chat: URI.parse(buildDefaultChatUri(unknownExternal)), startTime: 5, modifiedTime: 6 },
		];
		const emitted: unknown[] = [];
		const emitCodexChats = (CodexAgent.prototype as unknown as {
			_emitCodexChats(this: {
				_isShuttingDown: boolean;
				_store: { isDisposed: boolean };
				_listCodexChats(): Promise<typeof chats>;
				_isKnownCodexChat(chat: (typeof chats)[number]): Promise<boolean>;
				_onDidDiscoverChats: { fire(chats: readonly unknown[]): void };
				_logService: { warn(message: string): void };
			}): Promise<boolean>;
		})._emitCodexChats;

		await emitCodexChats.call({
			_isShuttingDown: false,
			_store: { isDisposed: false },
			_listCodexChats: async () => chats,
			_isKnownCodexChat: async chat => {
				const id = AgentSession.id(URI.parse(parseRequiredSessionUriFromChatUri(chat.chat)));
				return id !== 'unknown-external';
			},
			_onDidDiscoverChats: { fire: chats => emitted.push(...chats) },
			_logService: { warn: () => { } },
		});

		assert.deepStrictEqual(emitted, [
			{ ...chats[0], external: false },
			{ ...chats[1], external: false },
			{ ...chats[2], external: true },
		]);
	});
});
