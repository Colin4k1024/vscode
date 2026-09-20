/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { AgentSession } from '../../../common/agent.js';
import { buildDefaultChatUri, type ModelSelection } from '../../../common/state/sessionState.js';
import { CodexAgent, parseCodexModelSelection, toCodexModelSelectionId } from '../../../node/codex/codexAgent.js';
import { buildCodexResumeParams } from '../../../node/codex/codexLaunchConfig.js';
import { reportCodexProviderSwitch } from '../../../node/codex/codexProviderSwitchTelemetry.js';
import type { ITelemetryService } from '../../../../telemetry/common/telemetry.js';

/**
 * D12 / Issue #14 — A5 Codex session/thread identity invariants.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../../../../', import.meta.url));

// ---- Prototype harnesses -------------------------------------------------------

interface IModelHarness {
	_logService: NullLogService;
	_modelsRefreshPromise: Promise<unknown> | undefined;
	_models: { get(): readonly { readonly id: string }[] };
	refreshModels(): Promise<void>;
	_defaultModel(): ModelSelection | undefined;
}

function makeModelHarness(catalog: readonly { id: string }[], defaultModel: ModelSelection | undefined = { id: 'default-model' }): IModelHarness {
	return {
		_logService: new NullLogService(),
		_modelsRefreshPromise: undefined,
		_models: { get: () => catalog },
		refreshModels: () => Promise.resolve(),
		_defaultModel: () => defaultModel,
	};
}

async function resolveRestoredModel(harness: IModelHarness, model: ModelSelection | undefined): Promise<ModelSelection | undefined> {
	const fn = (CodexAgent.prototype as unknown as {
		_resolveRestoredModel(this: IModelHarness, model: ModelSelection | undefined): Promise<ModelSelection | undefined>;
	})._resolveRestoredModel;
	assert.strictEqual(typeof fn, 'function', 'CodexAgent._resolveRestoredModel must exist');
	return fn.call(harness, model);
}

const OPENAI_GPT = toCodexModelSelectionId('openai', 'gpt-a');
const OPENAI_GPT_B = toCodexModelSelectionId('openai', 'gpt-b');
const COPILOT_GPT = toCodexModelSelectionId('vscode-proxy', 'gpt-a');

suite('codexIdentityInvariants (D12 / A5)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// -- A5.1: _sessionIdByChatUri is exact routing only --------------------------

	suite('A5.1 exact chat routing', () => {

		interface IResolverHarness {
			readonly id: 'codex';
			readonly _sessionIdByChatUri: Map<string, string>;
		}

		function resolve(harness: IResolverHarness, address: URI): URI | undefined {
			const fn = (CodexAgent.prototype as unknown as {
				_resolveConversationSession(this: IResolverHarness, address: URI): URI | undefined;
			})._resolveConversationSession;
			return fn.call(harness, address);
		}

		test('an unbound chat URI is refused (never silently created or re-derived)', () => {
			const harness: IResolverHarness = { id: 'codex', _sessionIdByChatUri: new Map() };
			const chat = URI.parse(buildDefaultChatUri(AgentSession.uri('codex', 's1').toString()));
			assert.strictEqual(resolve(harness, chat), undefined);
		});

		test('a binding for one chat never resolves a different chat', () => {
			const chatA = URI.parse(buildDefaultChatUri(AgentSession.uri('codex', 's1').toString()));
			const chatB = URI.parse(buildDefaultChatUri(AgentSession.uri('codex', 's2').toString()));
			const harness: IResolverHarness = { id: 'codex', _sessionIdByChatUri: new Map([[chatA.toString(), 'runtime-a']]) };
			assert.strictEqual(resolve(harness, chatA)?.toString(), AgentSession.uri('codex', 'runtime-a').toString());
			assert.strictEqual(resolve(harness, chatB), undefined, 'no cross-chat bleed');
		});
	});

	// -- A5.2: unknown-thread callbacks are dropped, never crash -------------------

	suite('A5.2 unknown-thread callback routing', () => {

		test('_dispatchItemCompleted for an unregistered threadId is a logged no-op', () => {
			const fired: unknown[] = [];
			const harness = {
				_logService: new NullLogService(),
				_sessionIdByThreadId: new Map<string, string>(),
				_sessions: new Map<string, never>(),
				_subagentsByThreadId: new Map<string, never>(),
				_fire: (...args: unknown[]) => fired.push(args),
				_fireSubagent: (...args: unknown[]) => fired.push(args),
			};
			const fn = (CodexAgent.prototype as unknown as {
				_dispatchItemCompleted(this: unknown, params: unknown): void;
			})._dispatchItemCompleted;
			assert.strictEqual(typeof fn, 'function', 'CodexAgent._dispatchItemCompleted must exist');
			assert.doesNotThrow(() => fn.call(harness, {
				threadId: 'thr_unknown', turnId: 'turn_a',
				item: { type: 'agentMessage', id: 'm1', text: 'hi', phase: null, memoryCitation: null },
				completedAtMs: 0,
			}), 'unknown threadId callback must be dropped, not crash');
			assert.deepStrictEqual(fired, [], 'nothing is fired for an unknown thread');
		});
	});

	// -- A5.3/A5.4/A5.5: restored-model resolution ---------------------------------

	suite('A5.3-A5.5 restored model resolution', () => {

		test('A5.3: a stored model still in the catalog is preserved exactly', async () => {
			const harness = makeModelHarness([{ id: OPENAI_GPT }, { id: OPENAI_GPT_B }]);
			assert.deepStrictEqual(await resolveRestoredModel(harness, { id: OPENAI_GPT }), { id: OPENAI_GPT });
		});

		test('A5.3: a missing stored model falls back to the first model of the SAME native provider', async () => {
			const harness = makeModelHarness([{ id: OPENAI_GPT_B }, { id: COPILOT_GPT }]);
			assert.deepStrictEqual(await resolveRestoredModel(harness, { id: OPENAI_GPT }), { id: OPENAI_GPT_B });
		});

		test('A5.4: never crosses the billing provider, even when the other provider lists the same model name', async () => {
			// The stored openai model is gone; only vscode-proxy (Copilot billing)
			// has a model. The same NAME under the other provider must not be
			// adopted — a distinct id means no id match, and the provider-filtered
			// fallback finds nothing on the openai side.
			const harness = makeModelHarness([{ id: COPILOT_GPT }]);
			const result = await resolveRestoredModel(harness, { id: OPENAI_GPT });
			assert.deepStrictEqual(result, { id: OPENAI_GPT }, 'stored selection is preserved rather than silently re-billed to another provider');
			assert.strictEqual(parseCodexModelSelection(result!).modelProvider, 'openai');
		});

		test('A5.5: a stored provider with no available models keeps its selection; only a never-chosen thread gets the global default', async () => {
			const harness = makeModelHarness([]);
			assert.deepStrictEqual(await resolveRestoredModel(harness, { id: OPENAI_GPT }), { id: OPENAI_GPT }, 'history stays readable under its original model');
			assert.deepStrictEqual(await resolveRestoredModel(harness, undefined), { id: 'default-model' }, 'no stored choice → global default');
		});

		test('A5.3: a queued model discovery is awaited before resolving (and follow-up refreshes too)', async () => {
			const catalog: { id: string }[] = [];
			const harness = makeModelHarness(catalog);
			let releaseFirst!: () => void;
			let releaseSecond!: () => void;
			const firstRefresh = new Promise<void>(r => { releaseFirst = r; });
			harness._modelsRefreshPromise = firstRefresh;
			const resolution = resolveRestoredModel(harness, { id: OPENAI_GPT });
			let settled = false;
			void resolution.then(() => { settled = true; });
			await new Promise(r => setTimeout(r, 20));
			assert.strictEqual(settled, false, 'resolution waits for the in-flight model discovery');
			// The first refresh queues a second one; both must be followed.
			const secondRefresh = new Promise<void>(r => { releaseSecond = r; });
			harness._modelsRefreshPromise = secondRefresh;
			releaseFirst();
			await new Promise(r => setTimeout(r, 20));
			assert.strictEqual(settled, false, 'a refresh queued behind the first is also awaited');
			catalog.push({ id: OPENAI_GPT });
			harness._modelsRefreshPromise = undefined;
			releaseSecond();
			assert.deepStrictEqual(await resolution, { id: OPENAI_GPT });
		});
	});

	// -- A5.6: thread/resume always carries model + provider ------------------------

	suite('A5.6 thread/resume model pinning', () => {

		test('buildCodexResumeParams always emits model and modelProvider', () => {
			for (const model of [
				{ modelProvider: 'openai', modelId: 'gpt-a' },
				{ modelProvider: 'vscode-proxy', modelId: 'claude-x' },
			]) {
				const variants: readonly { readonly workingDirectories?: readonly string[]; readonly configOverrides?: Record<string, true> }[] = [
					{},
					{ workingDirectories: ['/w'] },
					{ configOverrides: { 'x.y': true } },
				];
				for (const extras of variants) {
					const params = buildCodexResumeParams(model, 'thr_1', {}, extras.workingDirectories, extras.configOverrides);
					assert.strictEqual(params.model, model.modelId, 'model must be explicit (else the SDK default wins)');
					assert.strictEqual(params.modelProvider, model.modelProvider, 'modelProvider must be explicit');
					assert.strictEqual(params.threadId, 'thr_1');
				}
			}
		});
	});

	// -- A5.8: provider switch reloads, never replaces ------------------------------

	suite('A5.8 provider switch reload semantics', () => {

		test('the resume path reuses the same threadId and never issues thread/start as a substitute', () => {
			const source = readFileSync(`${REPO_ROOT}src/vs/platform/agentHost/node/codex/codexAgent.ts`, 'utf8');
			const resumeFnStart = source.indexOf('const resumeWithHookTrust = async () =>');
			assert.ok(resumeFnStart > 0, 'resume block not found');
			// The resume block ends where the post-resume bookkeeping begins.
			const resumeFnEnd = source.indexOf('let resumeResult = await resumeWithHookTrust()', resumeFnStart);
			assert.ok(resumeFnEnd > resumeFnStart);
			const resumeBlock = source.slice(resumeFnStart, resumeFnEnd);
			assert.ok(resumeBlock.includes("request<'thread/resume', ThreadResumeResponse>"), 'resume goes through thread/resume');
			assert.ok(!resumeBlock.includes("'thread/start'"), 'resume must never create a replacement thread');
			assert.ok(/buildCodexResumeParams\(\s*resolvedModel,\s*threadId,/.test(resumeBlock), 'resume params bind the SAME threadId — the turn-id mapping survives a provider switch');
		});
	});

	// -- A5.9: provider-switch telemetry counts accepted turns only ------------------

	suite('A5.9 provider-switch telemetry timing', () => {

		test('reportCodexProviderSwitch has a single call site, after the turn/start await, gated on the same thread', () => {
			const source = readFileSync(`${REPO_ROOT}src/vs/platform/agentHost/node/codex/codexAgent.ts`, 'utf8');
			const callSites = [...source.matchAll(/reportCodexProviderSwitch\(/g)].map(m => m.index);
			// One is the import; exactly one real call site is allowed.
			const realCalls = callSites.filter(i => !source.slice(Math.max(0, i - 40), i).includes('import'));
			assert.strictEqual(realCalls.length, 1, 'telemetry must have exactly one call site (the accepted-turn path)');
			const call = realCalls[0];
			const turnStartAwait = source.lastIndexOf("await conn.client.request<'turn/start'>", call);
			assert.ok(turnStartAwait > 0 && turnStartAwait < call, 'the count happens only AFTER turn/start is accepted');
			const between = source.slice(turnStartAwait, call);
			assert.ok(between.includes('session.firstTurnSent = true'), 'history committed before counting');
			assert.ok(/if \(providerSwitch\?\.threadId === threadId\)/.test(between), 'gated on the switch belonging to THIS thread');
		});

		test('picker-only changes and unchanged providers are never counted', () => {
			const events: unknown[] = [];
			const telemetry = { publicLog2: (name: string, data: unknown) => events.push({ name, data }) } as unknown as ITelemetryService;
			// Same provider → picker re-select of the current provider.
			reportCodexProviderSwitch(telemetry, 'openai', 'openai', true);
			reportCodexProviderSwitch(telemetry, 'vscode-proxy', 'vscode-proxy', false);
			// Unknown/custom providers → not a subscription switch.
			reportCodexProviderSwitch(telemetry, undefined, 'openai', true);
			reportCodexProviderSwitch(telemetry, 'openai', 'some-custom-provider', true);
			assert.deepStrictEqual(events, [], 'no event without a real openai↔copilot subscription switch');
		});
	});
});
