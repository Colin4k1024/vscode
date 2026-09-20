/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic Agent Host end-to-end tests for the bundled Codex provider.
 */

import assert from 'assert';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../../base/common/path.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { AgentHostCodexMultiRootEnabledConfigKey } from '../../../../common/agentHostSchema.js';
import { SubscribeResult, type ListSessionsResult } from '../../../../common/state/protocol/commands.js';
import { McpServerStatus } from '../../../../common/state/protocol/state.js';
import { retry } from '../../../../../../base/common/async.js';
import { PROTOCOL_VERSION } from '../../../../common/state/protocol/version/registry.js';
import { ActionType, type ChatErrorAction, type ChatToolCallReadyAction } from '../../../../common/state/sessionActions.js';
import { buildDefaultChatUri, CustomizationLoadStatus, CustomizationType, ROOT_STATE_URI, type DirectoryCustomization, type McpServerCustomization, type RootState, type SessionState } from '../../../../common/state/sessionState.js';
import { readCodexAccountInfo } from '../../../../common/meta/codexAccount.js';
import { AgentHostE2EServerLease, createRealSession, dispatchTurn, driveTurnToCompletion, removeTempDirs, resolveGitHubToken, startBackgroundApprovalLoop } from '../harness/agentHostE2ETestHarness.js';
import { defineAgentHostE2ETests } from '../suites/agentHostE2ESuites.js';
import { getActionEnvelope, isActionNotification, TestProtocolClient } from '../../serverIntegrationTestHelpers.js';
import { CODEX_CONFIG } from './codexTestConfiguration.js';

const RECORD = process.env['AGENT_HOST_REPLAY_RECORD'] === '1' || process.env['AGENT_HOST_UPDATE_SNAPSHOTS'] === '1';
const portableShellToolReplayEnabled = RECORD || process.platform !== 'linux' || !CODEX_CONFIG.shellToolReplayUnstableOnLinux;

defineAgentHostE2ETests(CODEX_CONFIG);

(CODEX_CONFIG.enabled ? suite : suite.skip)('Agent Host E2E — Codex (Codex-specific)', function () {

	let client: TestProtocolClient;
	let lease: AgentHostE2EServerLease | undefined;
	const createdSessions: string[] = [];
	const tempDirs: string[] = [];

	suiteSetup(function () {
		lease = new AgentHostE2EServerLease(CODEX_CONFIG, { codexSdkRoot: CODEX_CONFIG.codexSdkRoot });
	});

	setup(async function () {
		this.timeout(60_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		({ client } = await lease.acquire(this.currentTest?.title ?? 'unknown'));
	});

	teardown(async function () {
		this.timeout(120_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		const failed = this.currentTest?.state === 'failed';
		await lease.release(createdSessions, failed);
	});

	test('invalid workspace skills retain their paths and validation diagnostics', async function () {
		this.timeout(120_000);

		const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ahp-codex-invalid-skills-')));
		tempDirs.push(workspace);
		mkdirSync(join(workspace, '.git'));
		const names = ['missing-description-one', 'missing-description-two'];
		const skillUris = names.map(name => {
			const directory = join(workspace, '.agents', 'skills', name);
			mkdirSync(directory, { recursive: true });
			const path = join(directory, 'SKILL.md');
			writeFileSync(path, `---\nname: ${name}\n---\nThis skill intentionally has no description.\n`);
			return URI.file(path).toString();
		});
		const sessionUri = await createRealSession(client, CODEX_CONFIG, 'codex-invalid-skills', createdSessions, URI.file(workspace));
		await driveTurnToCompletion(client, sessionUri, 'turn-invalid-skills', 'Reply exactly "READY".', 1);

		const fileIdentity = (uri: string) => {
			const stat = statSync(URI.parse(uri).fsPath);
			return { device: stat.dev, inode: stat.ino };
		};
		await client.waitForNotification(n => {
			if (!isActionNotification(n, ActionType.SessionCustomizationUpdated)) {
				return false;
			}
			const { channel, action } = getActionEnvelope(n);
			return channel === sessionUri
				&& action.type === ActionType.SessionCustomizationUpdated
				&& action.customization.type === CustomizationType.Directory
				&& action.customization.children?.some(child => names.includes(child.name)) === true;
		}, 30_000);
		const result = await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
		const containers = ((result.snapshot!.state as SessionState).customizations ?? [])
			.filter((customization): customization is DirectoryCustomization =>
				customization.type === CustomizationType.Directory
				&& customization.children?.some(child => names.includes(child.name)) === true);

		assert.deepStrictEqual(containers.map(container => ({
			enabled: container.enabled,
			writable: container.writable,
			load: container.load,
			children: container.children?.map(child => ({
				type: child.type,
				name: child.name,
				file: fileIdentity(child.uri),
				enabled: child.type === CustomizationType.Skill ? child.enabled : undefined,
			})),
		})), [{
			enabled: false,
			writable: false,
			load: { kind: CustomizationLoadStatus.Error, message: 'missing field `description`' },
			children: names.map((name, index) => ({ type: CustomizationType.Skill, name, file: fileIdentity(skillUris[index]), enabled: false })),
		}]);
	});

	(portableShellToolReplayEnabled ? test : test.skip)('secondary workspace skill reaches the Codex model request', async function () {
		this.timeout(120_000);

		const parent = mkdtempSync(join(tmpdir(), 'ahp-codex-multiroot-'));
		tempDirs.push(parent);
		const rootA = join(parent, 'a');
		const rootB = join(parent, 'b');
		const skillName = 'secondary-root-marker';
		const marker = 'CODEX_SECONDARY_ROOT_SKILL_MARKER_73';
		const skillDirectory = join(rootB, '.agents', 'skills', skillName);
		const readSkillCommand = `node -e "process.stdout.write(require('fs').readFileSync('../b/.agents/skills/${skillName}/SKILL.md', 'utf8'))"`;
		mkdirSync(rootA, { recursive: true });
		mkdirSync(skillDirectory, { recursive: true });
		writeFileSync(join(skillDirectory, 'SKILL.md'), [
			'---',
			`name: ${skillName}`,
			'description: Confirms that Codex loaded a skill from a secondary workspace root.',
			'---',
			'',
			`When invoked, follow this marker instruction: ${marker}`,
		].join('\n'));

		client.setWorkingDirectory(parent);
		await client.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'codex-multiroot-skill' }, 30_000);
		await client.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: resolveGitHubToken() }, 30_000);
		await client.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI });
		let multiRootEnabled = false;

		try {
			client.dispatch({
				channel: ROOT_STATE_URI,
				clientSeq: 0,
				action: { type: ActionType.RootConfigChanged, config: { [AgentHostCodexMultiRootEnabledConfigKey]: true } },
			});
			await client.waitForNotification(n => {
				if (!isActionNotification(n, ActionType.RootConfigChanged)) {
					return false;
				}
				const action = getActionEnvelope(n).action as { readonly config?: Readonly<Record<string, boolean>> };
				return action.config?.[AgentHostCodexMultiRootEnabledConfigKey] === true;
			}, 30_000);
			multiRootEnabled = true;

			const sessionUri = URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString();
			await client.call('createSession', {
				channel: sessionUri,
				provider: CODEX_CONFIG.provider,
				workingDirectories: [URI.file(rootA).toString(), URI.file(rootB).toString()],
				config: { isolation: 'folder', ...CODEX_CONFIG.sessionConfig },
			}, 30_000);
			createdSessions.push(sessionUri);
			await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
			await client.call<SubscribeResult>('subscribe', { channel: buildDefaultChatUri(sessionUri) });
			client.dispatch({
				channel: sessionUri,
				clientSeq: 1,
				action: { type: ActionType.SessionTitleChanged, title: 'Secondary workspace skill test' },
			});
			await client.waitForNotification(n => isActionNotification(n, ActionType.SessionTitleChanged), 30_000);
			client.clearReceived();

			const prompt = `Use the ${skillName} skill. Read its SKILL.md by running exactly this shell command, with no modifications: \`${readSkillCommand}\`. Then reply with exactly done.`;
			const approvalLoop = startBackgroundApprovalLoop(client, {
				approvalSeqStart: 100,
				allow: [{ toolName: CODEX_CONFIG.shellToolName }],
			});
			try {
				dispatchTurn(client, sessionUri, 'turn-secondary-skill', prompt, 2);
				await client.waitForNotification(
					n => isActionNotification(n, 'chat/turnComplete') || isActionNotification(n, 'chat/error'),
					90_000,
				);
			} finally {
				await approvalLoop.stop();
			}

			const errors = client.receivedNotifications(n => isActionNotification(n, 'chat/error'));
			assert.deepStrictEqual({
				approvalErrors: approvalLoop.errors,
				errorCount: errors.length,
				modelRequestIncludesMarker: lease!.observedModelRequestBodies.some(body => body.includes(marker)),
			}, {
				approvalErrors: [],
				errorCount: 0,
				modelRequestIncludesMarker: true,
			});
		} finally {
			if (multiRootEnabled) {
				client.dispatch({
					channel: ROOT_STATE_URI,
					clientSeq: 3,
					action: { type: ActionType.RootConfigChanged, config: { [AgentHostCodexMultiRootEnabledConfigKey]: false } },
				});
				await client.waitForNotification(n => {
					if (!isActionNotification(n, ActionType.RootConfigChanged)) {
						return false;
					}
					const action = getActionEnvelope(n).action as { readonly config?: Readonly<Record<string, boolean>> };
					return action.config?.[AgentHostCodexMultiRootEnabledConfigKey] === false;
				}, 30_000);
			}
		}
	});

	suiteTeardown(async function () {
		this.timeout(120_000);
		const errors: Error[] = [];
		try {
			await lease?.dispose();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		try {
			await removeTempDirs(tempDirs);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, `Failed to dispose Codex-specific E2E suite resources: ${errors.map(error => error.message).join('; ')}`);
		}
	});
});

/**
 * Codex negative-path and isolation acceptance scenarios (issue #13,
 * `01-ACCEPTANCE-CORE.md` §B/D13/D14). Everything here talks to the host
 * exclusively over AHP via `IAgentHostTarget`; no host internals are imported.
 *
 * - B1:  an unusable Codex SDK root must fail fast and visibly without
 *        wedging the host or degrading other providers.
 * - B16: an MCP server that fails to start surfaces an error state and does
 *        not block the turn.
 * - B18: a client tool result with an empty body is backfilled before it is
 *        handed back to the model (codex rejects empty tool bodies).
 * - AC4: an ambient `CODEX_HOME` override in the test process environment
 *        must not leak into the agent host or the provider subprocess.
 */
(CODEX_CONFIG.enabled ? suite : suite.skip)('Agent Host E2E — Codex (negative paths)', function () {

	let client: TestProtocolClient;
	let lease: AgentHostE2EServerLease | undefined;
	const createdSessions: string[] = [];
	const tempDirs: string[] = [];

	/**
	 * Titles that never cross the model boundary replay against the shared
	 * strict empty fixture: any model request they cause is a hard cache miss.
	 */
	const hostOnlyTitles = new Set<string>([
		// Drives its own dedicated target; the suite server stays idle.
		'an unusable Codex SDK root fails chat setup fast without wedging the host',
		// Runs its turn against a dedicated target launched while the ambient
		// override is set, so the suite server's shared proxy must stay empty.
		'an ambient CODEX_HOME override does not leak into the agent host or provider processes',
	]);

	suiteSetup(function () {
		lease = new AgentHostE2EServerLease(CODEX_CONFIG, { codexSdkRoot: CODEX_CONFIG.codexSdkRoot });
	});

	setup(async function () {
		this.timeout(60_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		const title = this.currentTest?.title ?? 'unknown';
		({ client } = await lease.acquire(title, hostOnlyTitles.has(title) ? 'none' : 'recorded'));
	});

	teardown(async function () {
		this.timeout(120_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		const failed = this.currentTest?.state === 'failed';
		await lease.release(createdSessions, failed);
	});

	test('an unusable Codex SDK root fails chat setup fast without wedging the host', async function () {
		this.timeout(120_000);

		// A directory that exists but contains no runnable Codex binary.
		const bogusSdkRoot = mkdtempSync(join(tmpdir(), 'ahp-codex-bogus-sdk-'));
		tempDirs.push(bogusSdkRoot);
		const workspace = mkdtempSync(join(tmpdir(), 'ahp-codex-bogus-sdk-ws-'));
		tempDirs.push(workspace);

		// A dedicated target whose Codex SDK root is unusable. The suite lease
		// keeps its valid root, so this failure stays scoped to this target.
		const bogusLease = new AgentHostE2EServerLease(CODEX_CONFIG, { codexSdkRoot: bogusSdkRoot });
		try {
			const { client: c } = await bogusLease.acquire(this.test?.title ?? 'unknown', 'none');
			try {
				await c.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'codex-bogus-sdk' }, 30_000);
				await c.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: resolveGitHubToken() }, 30_000);
				const rootResult = await c.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI });
				const agents = (rootResult.snapshot!.state as RootState).agents;
				assert.ok(agents.some(a => a.provider === 'copilotcli'), `host must keep serving the other provider, got: ${agents.map(a => a.provider).join(', ')}`);

				// The session catalog entry is created, but materializing the
				// default chat needs the Codex binary and must fail fast with a
				// protocol error — not hang, crash, or silently fall through to
				// another provider.
				const sessionUri = URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString();
				await c.call('createSession', {
					channel: sessionUri,
					provider: CODEX_CONFIG.provider,
					workingDirectories: [URI.file(workspace).toString()],
					config: { isolation: 'folder', ...CODEX_CONFIG.sessionConfig },
				}, 30_000);
				await c.call<SubscribeResult>('subscribe', { channel: sessionUri });
				const chatUri = buildDefaultChatUri(sessionUri);
				await c.call<SubscribeResult>('subscribe', { channel: chatUri });

				// The first turn is where the binary is spawned: it must fail
				// fast with an actionable, user-visible error rather than
				// hanging, crashing the host, or silently retargeting another
				// provider.
				dispatchTurn(c, sessionUri, 'turn-bogus-sdk', 'hello', 1);
				const failure = await c.waitForNotification(n =>
					(isActionNotification(n, 'chat/error') || isActionNotification(n, 'chat/turnComplete'))
					&& getActionEnvelope(n).channel === chatUri,
					60_000);
				assert.ok(isActionNotification(failure, 'chat/error'), `expected a chat error, got: ${JSON.stringify(getActionEnvelope(failure).action)}`);
				const failureAction = getActionEnvelope(failure).action as ChatErrorAction;
				assert.match(failureAction.part.error.message, /Codex binary not executable: /, 'the error must name the unusable binary path');

				// The host survives and keeps answering protocol requests.
				const sessions = await c.call<ListSessionsResult>('listSessions', { channel: ROOT_STATE_URI }, 30_000);
				assert.ok(sessions.items.some(item => item.resource === sessionUri), 'the created session stays listed after the failure');

				// No model request may have been attempted on this path.
				assert.strictEqual(bogusLease.observedModelRequestBodies.length, 0, 'no model traffic is expected when the binary is unusable');
			} finally {
				c.close();
			}
		} finally {
			bogusLease.verifyReplay();
			await bogusLease.dispose();
		}
	});

	test('a failing MCP server surfaces an error state without blocking the turn', async function () {
		this.timeout(180_000);

		const workspace = mkdtempSync(join(tmpdir(), 'ahp-codex-broken-mcp-'));
		tempDirs.push(workspace);
		const serverName = 'd11_broken_server';

		await client.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'codex-broken-mcp' }, 30_000);
		await client.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: resolveGitHubToken() }, 30_000);
		await client.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI });

		client.dispatch({
			channel: ROOT_STATE_URI,
			clientSeq: 1,
			action: {
				type: ActionType.RootConfigChanged,
				config: { mcpServers: { [serverName]: { type: 'stdio', command: 'definitely-not-a-real-binary-d11' } } },
			},
		});
		await client.waitForNotification(n => isActionNotification(n, ActionType.RootConfigChanged), 30_000);

		try {
			const sessionUri = URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString();
			await client.call('createSession', {
				channel: sessionUri,
				provider: CODEX_CONFIG.provider,
				workingDirectories: [URI.file(workspace).toString()],
				config: { isolation: 'folder', ...CODEX_CONFIG.sessionConfig },
			}, 30_000);
			createdSessions.push(sessionUri);
			await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
			await client.call<SubscribeResult>('subscribe', { channel: buildDefaultChatUri(sessionUri) });

			// The turn triggers MCP startup; the failing server must surface an
			// actionable error state while the turn completes normally.
			const turnPromise = driveTurnToCompletion(client, sessionUri, 'turn-broken-mcp', 'Reply exactly "ready".', 2);
			const failureState = await retry(async () => {
				const result = await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
				const customization = ((result.snapshot!.state as SessionState).customizations ?? [])
					.find((c): c is McpServerCustomization => c.type === CustomizationType.McpServer && c.name === serverName);
				if (!customization || customization.state.kind !== McpServerStatus.Error) {
					throw new Error(`MCP server ${serverName} is not in the error state yet: ${JSON.stringify(customization?.state)}`);
				}
				return customization.state;
			}, 100, 100);
			assert.strictEqual(failureState.kind, McpServerStatus.Error);
			if (failureState.kind === McpServerStatus.Error) {
				assert.match(failureState.error.message, /failed to start/i, 'the surfaced error must explain the startup failure');
			}

			const result = await turnPromise;
			assert.strictEqual(result.responseText.trim(), 'ready', 'a failing MCP server must not block the turn');
		} finally {
			client.dispatch({
				channel: ROOT_STATE_URI,
				clientSeq: 3,
				action: { type: ActionType.RootConfigChanged, config: { mcpServers: {} } },
			});
			await client.waitForNotification(n => isActionNotification(n, ActionType.RootConfigChanged), 30_000);
		}
	});

	test('a client tool call with an empty result body is backfilled before it reaches the model', async function () {
		this.timeout(120_000);

		const workspace = mkdtempSync(join(tmpdir(), 'ahp-codex-empty-tool-result-'));
		tempDirs.push(workspace);
		const clientId = 'codex-empty-tool-result';
		const sessionUri = await createRealSession(client, CODEX_CONFIG, clientId, createdSessions, URI.file(workspace));
		const chatUri = buildDefaultChatUri(sessionUri);

		client.dispatch({
			channel: sessionUri,
			clientSeq: 1,
			action: {
				type: ActionType.SessionActiveClientSet,
				activeClient: {
					clientId,
					tools: [{
						name: 'get_empty_result',
						description: 'Always completes with an empty result body.',
						inputSchema: { type: 'object', properties: {}, required: [] },
					}],
				},
			},
		});
		await client.waitForNotification(n => isActionNotification(n, ActionType.SessionActiveClientSet), 30_000);
		client.clearReceived();

		const turnId = 'turn-empty-tool-result';
		dispatchTurn(client, sessionUri, turnId, 'Call the get_empty_result tool exactly once, then reply with exactly "done".', 2);

		const ready = await client.waitForNotification(n =>
			isActionNotification(n, ActionType.ChatToolCallReady)
			&& getActionEnvelope(n).channel === chatUri
			&& (getActionEnvelope(n).action as ChatToolCallReadyAction).turnId === turnId,
			90_000);
		const toolCallId = (getActionEnvelope(ready).action as ChatToolCallReadyAction).toolCallId;

		// The client answers with no content at all. Codex rejects an empty
		// tool body, so the host must substitute a non-empty one.
		client.dispatch({
			channel: chatUri,
			clientSeq: 3,
			action: {
				type: ActionType.ChatToolCallComplete,
				turnId,
				toolCallId,
				result: { success: true, pastTenseMessage: 'Ran the empty-result tool', content: [] },
			},
		});

		const outcome = await client.waitForNotification(n =>
			(isActionNotification(n, 'chat/turnComplete') || isActionNotification(n, 'chat/error'))
			&& getActionEnvelope(n).channel === chatUri
			&& (getActionEnvelope(n).action as { turnId?: string }).turnId === turnId,
			90_000);
		assert.ok(isActionNotification(outcome, 'chat/turnComplete'), `expected the turn to complete, got: ${JSON.stringify(getActionEnvelope(outcome).action)}`);

		// The backfilled body is what actually reached the model boundary.
		const lastRequest = lease!.observedModelRequestBodies.map(body => JSON.parse(body) as { input?: { type?: string; output?: unknown }[] }).at(-1);
		const toolOutput = lastRequest?.input?.find(item => item.type === 'function_call_output');
		assert.strictEqual(toolOutput?.output, 'Ran the empty-result tool', 'the empty client result must be backfilled with the past-tense summary');
	});

	test('an ambient CODEX_HOME override does not leak into the agent host or provider processes', async function () {
		this.timeout(180_000);

		// Probe directory posing as the user's real Codex home, exported into
		// the test process environment exactly as a developer shell would.
		const probe = mkdtempSync(join(tmpdir(), 'ahp-codex-home-probe-'));
		tempDirs.push(probe);
		writeFileSync(join(probe, 'sentinel.txt'), 'd11-isolation-probe');

		const previous = process.env['CODEX_HOME'];
		process.env['CODEX_HOME'] = probe;
		// A dedicated target launched while the ambient override is set; the
		// harness must clear it and confine provider state to its own
		// temporary home instead.
		const probeLease = new AgentHostE2EServerLease(CODEX_CONFIG, { codexSdkRoot: CODEX_CONFIG.codexSdkRoot });
		try {
			const { client: c } = await probeLease.acquire(this.test?.title ?? 'unknown');
			const workspace = mkdtempSync(join(tmpdir(), 'ahp-codex-home-probe-ws-'));
			tempDirs.push(workspace);
			// The session lives on the dedicated target, not on the suite's
			// shared server — track it locally so suite teardown never touches it.
			const probeSessions: string[] = [];
			const sessionUri = await createRealSession(c, CODEX_CONFIG, 'codex-home-probe', probeSessions, URI.file(workspace));
			const result = await driveTurnToCompletion(c, sessionUri, 'turn-codex-home-probe', 'Reply exactly "isolated".', 1);
			assert.strictEqual(result.responseText.trim(), 'isolated');

			// The provider really used a Codex home — the lease's isolated one —
			// so "nothing was written anywhere" cannot pass vacuously.
			assert.ok(readdirSync(probeLease.isolatedCodexHomeDir).length > 0, 'the provider must have written to the isolated Codex home');
		} finally {
			if (previous === undefined) {
				delete process.env['CODEX_HOME'];
			} else {
				process.env['CODEX_HOME'] = previous;
			}
			probeLease.verifyReplay();
			await probeLease.dispose();
		}

		assert.deepStrictEqual(readdirSync(probe).sort(), ['sentinel.txt'], 'the ambient CODEX_HOME probe directory must stay untouched');
		assert.strictEqual(readFileSync(join(probe, 'sentinel.txt'), 'utf8'), 'd11-isolation-probe');
	});

	suiteTeardown(async function () {
		this.timeout(120_000);
		const errors: Error[] = [];
		try {
			await lease?.dispose();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		try {
			await removeTempDirs(tempDirs);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, `Failed to dispose Codex negative-path E2E suite resources: ${errors.map(error => error.message).join('; ')}`);
		}
	});
});

/**
 * OpenAI-credential acceptance scenarios (issue #36, D03/D04/D05). The suite
 * provisions an API-key `auth.json` into the lease's isolated Codex home
 * before the host launches — the on-disk equivalent of the user having run
 * `codex login --api-key` ahead of time — and never authenticates a GitHub
 * token. Everything is asserted over AHP plus the replay proxy's observed
 * model requests; no host internals are imported.
 *
 * - D03: an API key credential signs the account in (`signedIn` / `apiKey`)
 *        and the model catalog still enumerates.
 * - D04: with zero GitHub credentials a full turn completes (only possible
 *        because the OpenAI credential drives the session).
 * - D05: the default model provider resolves to `openai`, observed on the
 *        request face the host sends to the model.
 */
(CODEX_CONFIG.enabled ? suite : suite.skip)('Agent Host E2E — Codex (OpenAI credentials)', function () {

	let client: TestProtocolClient;
	let lease: AgentHostE2EServerLease | undefined;
	const createdSessions: string[] = [];
	const tempDirs: string[] = [];

	/**
	 * Titles that never cross the model boundary replay against the shared
	 * strict empty fixture: any model request they cause is a hard cache miss.
	 */
	const hostOnlyTitles = new Set<string>([
		// Creates a session (to activate the provider and its catalog) but
		// never starts a turn; account probe, config, and model enumeration
		// are all app-server-local.
		'an api key credential signs the codex account in and enumerates the model catalog',
	]);

	suiteSetup(function () {
		lease = new AgentHostE2EServerLease(CODEX_CONFIG, { codexSdkRoot: CODEX_CONFIG.codexSdkRoot });
		// Provision the OpenAI credential before the host (and its startup
		// account probe) ever launches.
		writeFileSync(join(lease.isolatedCodexHomeDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-e2e-replay-placeholder' }));
	});

	setup(async function () {
		this.timeout(60_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		const title = this.currentTest?.title ?? 'unknown';
		({ client } = await lease.acquire(title, hostOnlyTitles.has(title) ? 'none' : 'recorded'));
	});

	teardown(async function () {
		this.timeout(120_000);
		if (!lease) {
			throw new Error('Agent Host E2E server lease was not initialized.');
		}
		const failed = this.currentTest?.state === 'failed';
		if (failed) {
			lease.dumpRuntimeLogsOnFailure(this.currentTest?.title ?? 'unknown');
		}
		await lease.release(createdSessions, failed);
	});

	/**
	 * Create a Codex session with no GitHub `authenticate` call at all: the
	 * OpenAI credential provisioned in the Codex home is the only credential
	 * the host has.
	 */
	async function createOpenAICredentialSession(c: TestProtocolClient, clientId: string, workingDirectory: URI): Promise<string> {
		await c.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId }, 30_000);
		const sessionUri = URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString();
		await c.call('createSession', {
			channel: sessionUri,
			provider: CODEX_CONFIG.provider,
			workingDirectories: [workingDirectory.toString()],
			config: { isolation: 'folder', ...CODEX_CONFIG.sessionConfig },
		}, 30_000);
		createdSessions.push(sessionUri);
		await c.call<SubscribeResult>('subscribe', { channel: sessionUri });
		await c.call<SubscribeResult>('subscribe', { channel: buildDefaultChatUri(sessionUri) });
		c.clearReceived();
		return sessionUri;
	}

	/** Poll the root state until the Codex agent's catalog is populated. */
	async function waitForCodexModels(c: TestProtocolClient): Promise<RootState['agents'][number]> {
		return retry(async () => {
			const root = await c.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI }, 30_000);
			const agent = (root.snapshot!.state as RootState).agents.find(a => a.provider === CODEX_CONFIG.provider);
			if (!agent || agent.models.length === 0) {
				throw new Error(`codex model catalog not populated yet (agents: ${(root.snapshot!.state as RootState).agents.map(a => `${a.provider}:${a.models.length}`).join(', ')})`);
			}
			return agent;
		}, 500, 60);
	}

	test('an api key credential signs the codex account in and enumerates the model catalog', async function () {
		this.timeout(120_000);

		const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ahp-codex-apikey-catalog-')));
		tempDirs.push(workspace);
		await createOpenAICredentialSession(client, 'codex-apikey-catalog', URI.file(workspace));

		// D03: the API key in the Codex home closes the authentication loop —
		// the account reads as signed in with `authType: 'apiKey'`.
		const account = await retry(async () => {
			const root = await client.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI }, 30_000);
			const info = readCodexAccountInfo(root.snapshot!.state as RootState);
			if (info.status !== 'signedIn' || info.authType !== 'apiKey') {
				throw new Error(`codex account not yet signed in via api key: ${JSON.stringify(info)}`);
			}
			return info;
		}, 500, 60);
		assert.strictEqual(account.status, 'signedIn');
		assert.strictEqual(account.authType, 'apiKey');

		// D03: the model catalog enumerates normally on the OpenAI credential
		// alone. Every entry is an OpenAI-provider model: with no GitHub token
		// there is no Copilot (`vscode-proxy`) catalog to merge in.
		const agent = await waitForCodexModels(client);
		assert.ok(agent.models.length > 0, 'expected a non-empty codex model catalog');
		const nonOpenAi = agent.models.filter(m => !m.id.startsWith('@provider=openai:'));
		assert.deepStrictEqual(nonOpenAi.map(m => m.id), [], 'without a GitHub token every codex model must come from the openai provider');
	});

	test('a turn completes with an openai api key credential and no github token', async function () {
		this.timeout(180_000);

		const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ahp-codex-apikey-turn-')));
		tempDirs.push(workspace);
		const sessionUri = await createOpenAICredentialSession(client, 'codex-apikey-turn', URI.file(workspace));

		// D04: no `authenticate` ever happened on this client — the only way a
		// turn can complete is through the OpenAI credential.
		const result = await driveTurnToCompletion(client, sessionUri, 'turn-no-github', 'Reply exactly "pong".', 1);
		assert.strictEqual(result.responseText.trim(), 'pong');
	});

	test('the default model provider is openai when an openai credential is present', async function () {
		this.timeout(180_000);

		const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ahp-codex-default-provider-')));
		tempDirs.push(workspace);
		// No model is selected anywhere — the session rides the host's default.
		const sessionUri = await createOpenAICredentialSession(client, 'codex-default-provider', URI.file(workspace));

		// The catalog-derived expectation: the default model is the first
		// openai-provider entry, matching the host's default-provider policy.
		const agent = await waitForCodexModels(client);
		const defaultEntry = agent.models.find(m => m.id.startsWith('@provider=openai:'));
		assert.ok(defaultEntry, `expected an openai-provider model in the catalog, got: ${agent.models.map(m => m.id).join(', ')}`);
		const expectedWireModel = decodeURIComponent(defaultEntry.id.slice('@provider=openai:'.length));

		const result = await driveTurnToCompletion(client, sessionUri, 'turn-default-provider', 'Reply exactly "default-provider-ok".', 1);
		assert.strictEqual(result.responseText.trim(), 'default-provider-ok');

		// D05: the provider choice is observable on the request face the host
		// sends to the model — the wire model is the openai default, not a
		// Copilot (`vscode-proxy`) catalog id.
		const bodies = lease!.observedModelRequestBodies.map(body => JSON.parse(body) as { model?: string });
		assert.ok(bodies.length > 0, 'expected at least one observed model request');
		assert.deepStrictEqual(bodies.map(b => b.model), [expectedWireModel]);
	});

	suiteTeardown(async function () {
		this.timeout(120_000);
		const errors: Error[] = [];
		try {
			await lease?.dispose();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		try {
			await removeTempDirs(tempDirs);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, `Failed to dispose Codex OpenAI-credential E2E suite resources: ${errors.map(error => error.message).join('; ')}`);
		}
	});
});
