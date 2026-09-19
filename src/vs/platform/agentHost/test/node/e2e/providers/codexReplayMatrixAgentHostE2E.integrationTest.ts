/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * D11 (#13): deterministic acceptance-matrix extension for the Codex replay
 * suite.
 *
 * Three groups of scenarios live here, all strict replay (no token, no
 * network):
 *
 * 1. **Harness integrity guarantees** — the record/replay contract itself is
 *    part of the acceptance matrix: an unrecorded model request must fail the
 *    run (strictness), a provider that stops early must fail on its unconsumed
 *    fixtures (completeness), and an ambient `CODEX_HOME` export must never
 *    reach the server (isolation). These tests deliberately trigger each
 *    failure mode and assert the harness reports it, so the guarantees are
 *    executable rather than documented.
 * 2. **Negative launch conditions** (acceptance-core B1/B2) — a Codex SDK root
 *    whose binary is not executable, and a host launched with no Codex SDK
 *    configuration at all. Both must fail with actionable errors over AHP
 *    while healthy providers keep working.
 * 3. **Provider-behavior negatives** (acceptance-core B16/B17/B18) — a broken
 *    plugin MCP server must surface a startup error without blocking the turn;
 *    an elicitation whose mode cannot be projected into questions must wait
 *    for the user instead of erroring or half-rendering; a dynamic tool result
 *    with no output must still complete the turn (codex rejects empty tool
 *    bodies).
 *
 * Every test launches its own server lease: each scenario needs its own launch
 * options or its own fixture window, and none of them may leak state into a
 * shared server.
 */

import assert from 'assert';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { join } from '../../../../../../base/common/path.js';
import { retry } from '../../../../../../base/common/async.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { SubscribeResult } from '../../../../common/state/protocol/commands.js';
import { PROTOCOL_VERSION } from '../../../../common/state/protocol/version/registry.js';
import { CustomizationEnablementKind, McpServerStatus } from '../../../../common/state/protocol/state.js';
import { buildDefaultChatUri, customizationId, CustomizationType, ROOT_STATE_URI, type McpServerCustomization, type PluginCustomization, type RootState, type SessionState } from '../../../../common/state/sessionState.js';
import { ActionType } from '../../../../common/state/sessionActions.js';
import { AgentHostE2EServerLease, createRealSession, dispatchTurn, driveTurnToCompletion, driveTurnWithCancelledInputToCompletion, removeTempDirs, resolveGitHubToken, textFromContent } from '../harness/agentHostE2ETestHarness.js';
import { getActionEnvelope, isActionNotification, TestProtocolClient, type IServerHandle } from '../../serverIntegrationTestHelpers.js';
import { CODEX_CONFIG, CODEX_SDK_ROOT } from './codexTestConfiguration.js';
import { COPILOT_CONFIG } from './copilotTestConfiguration.js';

const nodeRequire = createRequire(import.meta.url);

(CODEX_CONFIG.enabled ? suite : suite.skip)('Agent Host E2E — Codex (acceptance matrix)', function () {

	const tempDirs: string[] = [];

	/** Mirrors `codexBinaryTriple` in the implementation without importing it (governance principle 1). */
	const CODEX_BINARY_TRIPLES: Readonly<Record<string, string>> = {
		'linux-x64': 'x86_64-unknown-linux-musl',
		'linux-arm64': 'aarch64-unknown-linux-musl',
		'darwin-x64': 'x86_64-apple-darwin',
		'darwin-arm64': 'aarch64-apple-darwin',
		'win32-x64': 'x86_64-pc-windows-msvc',
		'win32-arm64': 'aarch64-pc-windows-msvc',
	};

	interface ILeaseHandle {
		readonly server: IServerHandle;
		readonly client: TestProtocolClient;
		readonly lease: AgentHostE2EServerLease;
		readonly createdSessions: string[];
		/**
		 * Release the test's sessions and verify the replay window. Pass
		 * `force` for scenarios whose leftover replay state is the point of the
		 * test (verification is then skipped in favor of a clean restart).
		 */
		release(force?: boolean): Promise<void>;
	}

	/**
	 * Runs one scenario against its own server lease. The scenario must call
	 * `handle.release()` on its success path; on failure the lease is
	 * force-restarted so cleanup noise never masks the original error.
	 */
	async function withStandaloneLease(
		title: string,
		options: { codexSdkRoot?: string },
		modelTraffic: 'recorded' | 'none',
		run: (handle: ILeaseHandle) => Promise<void>,
	): Promise<void> {
		const lease = new AgentHostE2EServerLease(CODEX_CONFIG, options);
		const createdSessions: string[] = [];
		let released = false;
		let handle: ILeaseHandle | undefined;
		try {
			const { server, client } = await lease.acquire(title, modelTraffic);
			handle = {
				server,
				client,
				lease,
				createdSessions,
				release: async force => {
					released = true;
					await lease.release(createdSessions, force ?? false);
				},
			};
			await run(handle);
			if (!released) {
				throw new Error('[agent-host-e2e] acceptance-matrix scenario finished without releasing its lease');
			}
		} catch (error) {
			if (handle && !released) {
				try {
					await lease.release(createdSessions, true);
				} catch {
					// forceRestart already tolerates cleanup failures; never mask the original error.
				}
			}
			throw error;
		} finally {
			await lease.dispose().catch(() => undefined);
		}
	}

	/** Recursive [path, kind-or-size] snapshot used by the isolation probe. */
	function snapshotDir(dir: string): string {
		const entries: string[] = [];
		const walk = (relative: string): void => {
			for (const name of readdirSync(join(dir, relative)).sort()) {
				const child = relative ? `${relative}/${name}` : name;
				const stat = statSync(join(dir, child));
				if (stat.isDirectory()) {
					entries.push(`${child} <dir>`);
					walk(child);
				} else {
					entries.push(`${child} ${readFileSync(join(dir, child), 'utf8').length}`);
				}
			}
		};
		walk('');
		return entries.join('\n');
	}

	suiteTeardown(async function () {
		this.timeout(120_000);
		await removeTempDirs(tempDirs);
	});

	// ── Harness integrity (D14 strictness / completeness, D13 isolation) ─────

	test('an unrecorded model request fails the suite run', async function () {
		this.timeout(180_000);
		// Drive a real turn against the strict shared empty fixture: every model
		// endpoint request is a hard cache miss. The turn must not silently
		// pass, and the proxy must report the miss instead of ever contacting
		// an upstream (replay never forwards).
		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'none', async ({ server, client, createdSessions, release }) => {
			const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-strictness-'));
			tempDirs.push(workspace);
			const sessionUri = await createRealSession(client, CODEX_CONFIG, 'codex-strictness', createdSessions, URI.file(workspace));
			const chat = buildDefaultChatUri(sessionUri);
			dispatchTurn(client, sessionUri, 'turn-strictness', 'Say exactly "hello" and nothing else', 1);

			// The model call fails locally with `x-should-retry: false`; the
			// provider should surface a turn error or an anomalous completion.
			// Whichever way the provider reacts, the *harness* verdict is the
			// cache miss — that is what fails CI.
			await client.waitForNotification(n =>
				(isActionNotification(n, 'chat/turnComplete') || isActionNotification(n, 'chat/error'))
				&& getActionEnvelope(n).channel === chat, 90_000)
				.catch(() => undefined);

			assert.throws(() => server.capiReplay?.assertNoReplayMismatches(), /cache miss\(es\)/, 'an unrecorded model request must fail replay verification');
			const replayError = server.capiReplay?.takeReplayError();
			assert.ok(replayError, 'expected a replay error for the unrecorded request');
			assert.match(replayError.message, /POST \/responses \(call #1\) — no recorded response/, 'the failure must name the unrecorded endpoint and call ordinal');
			// Consuming the failure leaves a clean window — proving that without
			// the consumption above, the ordinary teardown verification would
			// have failed this very test.
			assert.doesNotThrow(() => server.capiReplay?.assertNoReplayMismatches());
			// The errored turn may have left the provider uneasy; restart rather
			// than reuse (this test owns the whole lease anyway).
			await release(true);
		});
	});

	test('a provider that stops early fails on its unconsumed recorded responses', async function () {
		this.timeout(180_000);
		// The fixture for this test commits two exchanges but the turn only
		// consumes one (the first recorded response ends the turn). Completeness
		// requires the leftover exchange to fail verification with a message
		// that names the fixture remainder.
		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'recorded', async ({ server, client, createdSessions, release }) => {
			const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-completeness-'));
			tempDirs.push(workspace);
			const sessionUri = await createRealSession(client, CODEX_CONFIG, 'codex-completeness', createdSessions, URI.file(workspace));
			const result = await driveTurnToCompletion(client, sessionUri, 'turn-completeness', 'Say exactly "hello" and nothing else', 1);
			assert.strictEqual(result.responseText, 'hello');

			assert.throws(() => server.capiReplay?.assertNoReplayMismatches(), /unconsumed recorded responses/, 'a leftover fixture exchange must fail replay verification');
			assert.throws(() => server.capiReplay?.assertNoReplayMismatches(), /POST \/responses: 1 response\(s\)/, 'the failure must point at the unconsumed fixture entry');
			// The leftover exchange is the point of the scenario, so release
			// without re-running the completeness verdict.
			await release(true);
		});
	});

	test('ambient CODEX_HOME override stays isolated from the suite codex home', async function () {
		this.timeout(180_000);
		const title = this.test?.title ?? 'unknown';
		// Simulates `export CODEX_HOME=/some/real/path` in the developer shell:
		// while the ambient variable points at a probe directory carrying an
		// invalid config.toml, the server must confine codex to the lease's
		// temporary home. If the ambient path were honored, codex would parse
		// the canary config.toml and the session could not materialize.
		const probe = mkdtempSync(join(tmpdir(), 'e2e-codex-home-probe-'));
		tempDirs.push(probe);
		writeFileSync(join(probe, 'config.toml'), 'THIS IS NOT VALID TOML - E2E ISOLATION CANARY [[[');
		const probeBefore = snapshotDir(probe);
		const previousCodexHome = process.env['CODEX_HOME'];
		process.env['CODEX_HOME'] = probe;

		let isolatedHome: string | undefined;
		try {
			await withStandaloneLease(title, { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'recorded', async ({ client, createdSessions, lease, release }) => {
				isolatedHome = lease.codexHomeDir;
				const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-isolation-'));
				tempDirs.push(workspace);
				const sessionUri = await createRealSession(client, CODEX_CONFIG, 'codex-home-probe', createdSessions, URI.file(workspace));
				const result = await driveTurnToCompletion(client, sessionUri, 'turn-isolation', 'Say exactly "hello" and nothing else', 1);
				assert.strictEqual(result.responseText, 'hello');
				await release();
			});
		} finally {
			if (previousCodexHome === undefined) {
				delete process.env['CODEX_HOME'];
			} else {
				process.env['CODEX_HOME'] = previousCodexHome;
			}
		}

		assert.ok(isolatedHome, 'the lease must expose its isolated codex home');
		assert.notStrictEqual(isolatedHome, probe, 'the server must not use the ambient CODEX_HOME');
		let tempRoot = tmpdir();
		try {
			tempRoot = realpathSync(tempRoot);
		} catch {
			// keep the literal path
		}
		assert.ok(realpathSync(isolatedHome).startsWith(tempRoot), 'the isolated codex home must live under the system temp root');
		assert.strictEqual(snapshotDir(probe), probeBefore, 'the ambient CODEX_HOME path must not be written to');
	});

	// ── Negative launch conditions (acceptance-core B1/B2) ───────────────────

	(process.platform === 'win32' ? test.skip : test)('a codex sdk root with a non executable binary fails sessions with an actionable error', async function () {
		this.timeout(180_000);
		// B1: the binary exists but lacks the execute bit. Session creation must
		// fail with the documented error naming the binary path; the host must
		// stay alive and serve a healthy provider afterwards. (Skipped on
		// Windows, where `access(X_OK)` cannot distinguish a non-executable
		// regular file.)
		const fakeRoot = mkdtempSync(join(tmpdir(), 'e2e-codex-broken-sdk-'));
		tempDirs.push(fakeRoot);
		const target = `${process.platform}-${process.arch}`;
		const triple = CODEX_BINARY_TRIPLES[target];
		assert.ok(triple, `no known codex binary triple for ${target}`);
		const binaryDirectory = join(fakeRoot, 'node_modules', `@openai/codex-${target}`, 'vendor', triple, 'bin');
		mkdirSync(binaryDirectory, { recursive: true });
		const binaryPath = join(binaryDirectory, 'codex');
		writeFileSync(binaryPath, 'not executable\n');
		chmodSync(binaryPath, 0o644);

		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: fakeRoot }, 'none', async ({ client, createdSessions, release }) => {
			const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-b1-'));
			tempDirs.push(workspace);
			await client.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'codex-b1' }, 30_000);
			await client.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: resolveGitHubToken() }, 30_000);

			await assert.rejects(
				client.call('createSession', {
					channel: URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString(),
					provider: CODEX_CONFIG.provider,
					workingDirectories: [URI.file(workspace).toString()],
				}, 60_000),
				/Codex binary not executable/,
				'B1: the host must surface the documented actionable error',
			);

			// The failure must not take the host down or degrade healthy
			// providers: a Copilot session still materializes on the same server.
			const healthySession = await createRealSession(client, COPILOT_CONFIG, 'codex-b1-healthy-copilot', createdSessions, URI.file(join(workspace, 'healthy')));
			assert.ok(healthySession.startsWith('copilotcli:'));
			await release();
		});
	});

	test('a host without a codex sdk root keeps codex unregistered while healthy providers keep working', async function () {
		this.timeout(180_000);
		// B2 (factory-build analog): no `--codex-sdk-root`, no product
		// `agentSdks.codex` in this checkout, and no dev override — the harness
		// never supplies a Codex SDK root to this launch. Codex must be absent
		// from the agent catalog, `createSession` for codex must fail with an
		// actionable error, and the aggregate listing must still serve the
		// healthy Copilot provider.
		await withStandaloneLease(this.test?.title ?? 'unknown', {}, 'none', async ({ client, createdSessions, release }) => {
			const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-b2-'));
			tempDirs.push(workspace);
			await client.call('initialize', { channel: ROOT_STATE_URI, protocolVersions: [PROTOCOL_VERSION], clientId: 'codex-b2' }, 30_000);
			await client.call('authenticate', { channel: ROOT_STATE_URI, resource: 'https://api.github.com', token: resolveGitHubToken() }, 30_000);

			const root = await client.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI }, 30_000);
			const providers = ((root.snapshot!.state as RootState).agents ?? []).map(agent => agent.provider);
			assert.ok(!providers.includes('codex'), `codex must not appear in the agent catalog, got: ${providers.join(', ')}`);

			await assert.rejects(
				client.call('createSession', {
					channel: URI.from({ scheme: CODEX_CONFIG.scheme, path: `/${generateUuid()}` }).toString(),
					provider: CODEX_CONFIG.provider,
					workingDirectories: [URI.file(workspace).toString()],
				}, 30_000),
				/No agent provider registered for: codex/,
				'B2: creating a codex session without any SDK configuration must fail with the documented provider error',
			);

			const healthySession = await createRealSession(client, COPILOT_CONFIG, 'codex-b2-healthy-copilot', createdSessions, URI.file(join(workspace, 'healthy')));
			assert.ok(healthySession.startsWith('copilotcli:'));
			await release();
		});
	});

	// ── Provider-behavior negatives (acceptance-core B16/B17/B18) ────────────

	interface IPluginProbe {
		readonly sessionUri: string;
		readonly pluginUri: string;
		readonly workspace: string;
	}

	/**
	 * Materializes a client plugin whose `.mcp.json` declares the given MCP
	 * servers, mirroring `suites/mcpPluginSuite.ts` (the only in-repo pattern
	 * for plugin-owned MCP under strict replay).
	 */
	async function createPluginProbeSession(client: TestProtocolClient, prefix: string, mcpServers: Record<string, { command: string; args: readonly string[]; env?: Record<string, string> }>, createdSessions: string[]): Promise<IPluginProbe> {
		const workspace = mkdtempSync(join(tmpdir(), `e2e-codex-matrix-${prefix}-`));
		const plugin = mkdtempSync(join(tmpdir(), `e2e-codex-matrix-plugin-${prefix}-`));
		tempDirs.push(workspace, plugin);
		// Mirror the plugin shape `suites/mcpPluginSuite.ts` materializes: a
		// `.plugin` manifest plus the agent/rule/skill children providers parse.
		for (const directory of [join(plugin, '.plugin'), join(plugin, 'agents'), join(plugin, 'rules'), join(plugin, 'skills')]) {
			mkdirSync(directory, { recursive: true });
		}
		writeFileSync(join(plugin, '.plugin', 'plugin.json'), JSON.stringify({ name: 'E2E Matrix Plugin' }));
		writeFileSync(join(plugin, 'agents', 'probe.agent.md'), '---\nname: Probe Agent\ndescription: Uses the probe MCP server\n---\nUse the probe tool when asked.');
		writeFileSync(join(plugin, 'rules', 'probe.instructions.md'), '---\napplyTo:\n  - "**/*"\n---\nPrefer the probe tool.');
		writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers }));

		const clientId = `codex-matrix-${prefix}`;
		const sessionUri = await createRealSession(client, CODEX_CONFIG, clientId, createdSessions, URI.file(workspace));
		const pluginUri = URI.file(plugin).toString();
		client.dispatch({
			channel: sessionUri,
			clientSeq: 1,
			action: {
				type: ActionType.SessionActiveClientSet,
				activeClient: {
					clientId,
					tools: [],
					customizations: [{
						type: CustomizationType.Plugin,
						id: customizationId(pluginUri),
						uri: pluginUri,
						name: 'E2E Matrix Plugin',
						nonce: '1',
						enablement: [{ kind: CustomizationEnablementKind.Global, enabled: true }],
					}],
				},
			},
		});
		await client.waitForNotification(n =>
			isActionNotification(n, 'session/activeClientSet') && getActionEnvelope(n).channel === sessionUri,
			30_000,
		);
		return { sessionUri, pluginUri, workspace };
	}

	async function mcpServerState(client: TestProtocolClient, sessionUri: string, pluginUri: string): Promise<McpServerCustomization> {
		return retry(async () => {
			const result = await client.call<SubscribeResult>('subscribe', { channel: sessionUri }, 30_000);
			const plugin = ((result.snapshot!.state as SessionState).customizations ?? []).find((customization): customization is PluginCustomization =>
				customization.type === CustomizationType.Plugin && customization.uri === pluginUri);
			const server = plugin?.children?.find((child): child is McpServerCustomization => child.type === CustomizationType.McpServer);
			if (!server) {
				throw new Error('MCP server customization has not appeared yet');
			}
			return server;
		}, 100, 100);
	}

	test('a broken plugin MCP server surfaces a startup error without blocking the turn', async function () {
		this.timeout(240_000);
		// B16: the plugin's MCP server exits before completing the handshake.
		// The session must report the server as failed through customization
		// state and the model turn must still complete.
		const probeServerScript = join(tmpdir(), `e2e-codex-matrix-fail-mcp-${generateUuid()}.cjs`);
		writeFileSync(probeServerScript, 'process.exit(1);\n');
		tempDirs.push(probeServerScript);

		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'recorded', async ({ client, createdSessions, release }) => {
			const { sessionUri, pluginUri } = await createPluginProbeSession(client, 'b16', {
				broken_probe_server: { command: process.execPath, args: [probeServerScript] },
			}, createdSessions);

			// The failing server must not block the turn.
			const result = await driveTurnToCompletion(client, sessionUri, 'turn-b16', 'Say exactly "hello" and nothing else', 2);
			assert.strictEqual(result.responseText, 'hello');

			const state = await mcpServerState(client, sessionUri, pluginUri);
			assert.strictEqual(state.state.kind, McpServerStatus.Error, `the broken MCP server must surface an error state, got: ${JSON.stringify(state.state)}`);
			assert.strictEqual((state.state as { error?: { errorType?: string } }).error?.errorType, 'mcp-server-failed');
			await release();
		});
	});

	test('an elicitation with an unsupported mode waits for the user instead of erroring', async function () {
		this.timeout(240_000);
		// B17: the plugin MCP server elicits with `mode: "openai/form"`, an
		// opaque schema the host cannot project into typed questions. The host
		// must surface a message-only input request (no partial form), must not
		// answer the JSON-RPC request with an error, and must wait for the
		// user's decline before the turn continues.
		const plugin = mkdtempSync(join(tmpdir(), 'e2e-codex-matrix-plugin-b17-'));
		tempDirs.push(plugin);
		const mcpScript = join(plugin, 'probe-mcp.cjs');
		const mcpServerModule = nodeRequire.resolve('@modelcontextprotocol/sdk/server/index.js');
		const mcpStdioModule = nodeRequire.resolve('@modelcontextprotocol/sdk/server/stdio.js');
		const mcpTypesModule = nodeRequire.resolve('@modelcontextprotocol/sdk/types.js');
		writeFileSync(mcpScript, [
			`const { Server } = require(${JSON.stringify(mcpServerModule)});`,
			`const { StdioServerTransport } = require(${JSON.stringify(mcpStdioModule)});`,
			`const { CallToolRequestSchema, ListToolsRequestSchema } = require(${JSON.stringify(mcpTypesModule)});`,
			`const server = new Server({ name: "e2e-matrix-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });`,
			`server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [`,
			`  { name: "customization_elicit_unknown", description: "Asks with an opaque schema", inputSchema: { type: "object", properties: {} } },`,
			`] }));`,
			`server.setRequestHandler(CallToolRequestSchema, async request => {`,
			`  if (request.params.name === "customization_elicit_unknown") {`,
			`    const result = await server.elicitInput({ mode: "openai/form", message: "Provide opaque values", requestedSchema: { type: "object", properties: { opaque: { type: "string" } } } });`,
			`    return { content: [{ type: "text", text: \`ELICIT_UNKNOWN:\${result.action}\` }] };`,
			`  }`,
			`  return { content: [{ type: "text", text: "MATRIX_MCP_FALLBACK" }] };`,
			`});`,
			'void server.connect(new StdioServerTransport());',
		].join('\n'));

		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'recorded', async ({ client, createdSessions, release }) => {
			const { sessionUri } = await createPluginProbeSession(client, 'b17', {
				elicit_probe_server: { command: process.execPath, args: [mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } },
			}, createdSessions);

			// Codex starts MCP servers with the thread, i.e. at the first turn:
			// the recorded turn below both starts the server (the model calls
			// its tool) and drives the elicitation round trip. Cancelling the
			// surfaced request declines the elicitation, which unwinds the MCP
			// tool call and lets the turn finish against the second exchange.
			const result = await driveTurnWithCancelledInputToCompletion(
				client,
				sessionUri,
				'turn-b17',
				'Call customization_elicit_unknown exactly once, then reply with only its exact result.',
				2,
			);
			assert.ok(result.sawInputRequest, 'the unsupported elicitation must surface as chat/inputRequested');

			// The surfaced request must be message-only: no half-rendered form.
			const inputRequests = client.receivedNotifications(n => isActionNotification(n, 'chat/inputRequested'))
				.map(n => getActionEnvelope(n).action as { request: { message?: string; questions?: unknown } })
				.filter(action => action.request.message === 'Provide opaque values');
			assert.ok(inputRequests.length > 0, 'expected the opaque elicitation message on the wire');
			for (const action of inputRequests) {
				assert.strictEqual(action.request.questions, undefined, 'an opaque elicitation must not render partial questions');
			}

			// The tool result must carry the decline marker (from the real MCP
			// round trip, not from the replayed response).
			const toolTexts = client.receivedNotifications(n => isActionNotification(n, 'chat/toolCallComplete'))
				.map(n => getActionEnvelope(n).action as { turnId?: string; result?: { content?: object[] } })
				.filter(action => action.turnId === 'turn-b17')
				.map(action => textFromContent((action.result?.content ?? []) as never));
			assert.ok(toolTexts.some(text => /^ELICIT_UNKNOWN:(cancel|decline)$/.test(text)), `expected the declined elicitation result, got: ${JSON.stringify(toolTexts)}`);
			await release();
		});
	});

	test('a dynamic tool result with no output still completes the turn', async function () {
		this.timeout(240_000);
		// B18: the client completes a dynamic tool call with no text content and
		// no past-tense summary. codex rejects empty tool bodies, so the host
		// must backfill a non-empty one; the observable contract is that the
		// turn completes without a session error.
		await withStandaloneLease(this.test?.title ?? 'unknown', { codexSdkRoot: CODEX_CONFIG.codexSdkRoot }, 'recorded', async ({ client, createdSessions, release }) => {
			const workspace = mkdtempSync(join(tmpdir(), 'e2e-codex-b18-'));
			tempDirs.push(workspace);
			const sessionUri = await createRealSession(client, CODEX_CONFIG, 'codex-b18', createdSessions, URI.file(workspace));
			const chat = buildDefaultChatUri(sessionUri);

			client.dispatch({
				channel: sessionUri,
				clientSeq: 1,
				action: {
					type: ActionType.SessionActiveClientSet,
					activeClient: {
						clientId: 'codex-b18',
						tools: [{
							name: 'return_nothing',
							description: 'Returns nothing at all. Call this tool when asked for nothing.',
							inputSchema: { type: 'object', properties: {}, required: [] },
						}],
					},
				},
			});
			await client.waitForNotification(n =>
				isActionNotification(n, 'session/activeClientSet') && getActionEnvelope(n).channel === sessionUri,
				30_000,
			);

			dispatchTurn(client, sessionUri, 'turn-b18', 'Call return_nothing exactly once with no arguments, then reply exactly DONE_EMPTY_TOOL_OK.', 2);

			const seen = new Set<object>();
			let completedToolCallId: string | undefined;
			let nextSeq = 3;
			while (true) {
				const notification = await client.waitForNotification(n => !seen.has(n as object) && (
					isActionNotification(n, 'chat/toolCallStart')
					|| isActionNotification(n, 'chat/toolCallReady')
					|| isActionNotification(n, 'chat/turnComplete')
					|| isActionNotification(n, 'chat/error')), 120_000);
				seen.add(notification as object);
				if (getActionEnvelope(notification).channel !== chat) {
					continue;
				}
				if (isActionNotification(notification, 'chat/error')) {
					const action = getActionEnvelope(notification).action as { part?: { error?: { message?: string } } };
					throw new Error(`B18: turn errored on an empty dynamic tool result: ${action.part?.error?.message}`);
				}
				if (isActionNotification(notification, 'chat/toolCallStart')) {
					const action = getActionEnvelope(notification).action as { turnId?: string; toolName?: string };
					assert.strictEqual(action.toolName, 'return_nothing', `unexpected tool call: ${action.toolName}`);
					continue;
				}
				if (isActionNotification(notification, 'chat/toolCallReady')) {
					const action = getActionEnvelope(notification).action as { turnId?: string; toolCallId: string };
					if (action.turnId === 'turn-b18' && action.toolCallId !== completedToolCallId) {
						completedToolCallId = action.toolCallId;
						client.dispatch({
							channel: chat,
							clientSeq: nextSeq++,
							action: {
								type: ActionType.ChatToolCallComplete,
								turnId: 'turn-b18',
								toolCallId: action.toolCallId,
								// Deliberately empty: no text content and no
								// past-tense summary to fall back on.
								result: { success: true, content: [] },
							},
						});
					}
					continue;
				}
				const action = getActionEnvelope(notification).action as { turnId?: string };
				if (action.turnId !== 'turn-b18') {
					continue;
				}
				break;
			}
			assert.ok(completedToolCallId, 'the dynamic tool must have been surfaced to the client');
			await release();
		});
	});
});
