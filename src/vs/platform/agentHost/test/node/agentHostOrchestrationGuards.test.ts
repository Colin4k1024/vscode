/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { NullLogService } from '../../../log/common/log.js';
import { AgentHostStateManager } from '../../node/agentHostStateManager.js';
import { buildDefaultChatUri, isAhpChatChannel, parseChatUri, parseDefaultChatUri, SessionLifecycle, SessionStatus, type SessionSummary } from '../../common/state/sessionState.js';
import { CodexAgent } from '../../node/codex/codexAgent.js';
import { AgentSession } from '../../common/agent.js';

/**
 * D12 / Issue #14 — A4 orchestration invariants I1–I8 as executable guards.
 *
 * I1/I4/I6/I8 are static source guards (the invariants are about which code may
 * touch which state); I2 is a roundtrip + property test; I3 is pinned at the
 * Codex session-resolution seam. The guards read the implementation sources
 * from the checkout and fail the moment a new violation appears. Baselines
 * live in `test/node/baselines/` and must shrink, never grow.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const AGENT_HOST_NODE = `${REPO_ROOT}src/vs/platform/agentHost/node`;

function readSource(rel: string): string {
	return readFileSync(`${REPO_ROOT}${rel}`, 'utf8');
}

function listTsRecursive(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...listTsRecursive(full));
		} else if (entry.name.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Strip string literals and `//` line comments from a single source line so the
 * static guards match code only — a violation spelled inside a comment or a
 * string literal must never trip the guard (and a `//` inside a string must
 * not hide real code after it).
 *
 * Known boundary: multi-line block comments and interpolation expressions
 * inside template literals are not analyzed; both are rare in the guarded
 * files and would show up in code review.
 */
function stripLineNoise(line: string): string {
	const noStrings = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
	const commentIdx = noStrings.indexOf('//');
	return commentIdx >= 0 ? noStrings.slice(0, commentIdx) : noStrings;
}

/**
 * Reading INTO the blob (`x.providerData.foo`, `x.providerData?.foo`,
 * `x.providerData[k]`) or parsing it. Reads of the entry field itself
 * (`entry.providerData`) and the local Map variable named `providerData`
 * (Map.get) are fine — the regex requires a leading `.` before `providerData`.
 */
function findProviderDataOpacityViolations(rel: string, source: string): string[] {
	const violations: string[] = [];
	source.split('\n').forEach((rawLine, i) => {
		const line = stripLineNoise(rawLine);
		if (/JSON\.parse\s*\([^)]*providerData/.test(line)) {
			violations.push(`${rel}:${i + 1}: JSON.parse of providerData`);
		}
		if (/\.providerData\s*\??\s*[.\[]/.test(line)) {
			violations.push(`${rel}:${i + 1}: property/index access into providerData`);
		}
	});
	return violations;
}

/** Track the enclosing one-tab-indented method for each line of a class body. */
function methodPerLine(source: string): string[] {
	const lines = source.split('\n');
	const result: string[] = [];
	let method = '<class-body>';
	const methodRe = /^\t(?:private |public |protected |override |async |static |get |set )*([A-Za-z_]\w*)\s*\(/;
	for (const line of lines) {
		const m = methodRe.exec(line);
		if (m) {
			method = m[1];
		}
		result.push(method);
	}
	return result;
}

/**
 * Direct writes to the `_chatEntries` catalog: mutating method calls
 * (`set`/`delete`/`clear`), index writes (`_chatEntries[k] = ...` — flagged
 * conservatively on any index access), and whole-map reassignment
 * (`_chatEntries = ...`; `==`/`===` comparisons and `=>` arrow params are
 * excluded).
 *
 * Known boundary: aliased writes (`const entries = this._chatEntries;
 * entries.set(...)`) are NOT caught — detecting them needs dataflow analysis,
 * which is out of scope for a line-based guard. The baseline review process
 * (this guard fails on any NEW direct writer) plus code review cover it.
 */
const CHAT_ENTRIES_WRITE_RE = /_chatEntries\s*(?:\.(?:set|delete|clear)\s*\(|\[|=(?![=>]))/;

/** Field declarations (`private readonly _chatEntries = new Map(...)`) are not writes. */
const CHAT_ENTRIES_DECL_RE = /\b(?:private|public|protected|readonly)\b[^=]*_chatEntries\s*[:=]/;

/** True when the (already comment/string-stripped) line writes `_chatEntries`. */
function isChatEntriesWrite(line: string): boolean {
	return CHAT_ENTRIES_WRITE_RE.test(line) && !CHAT_ENTRIES_DECL_RE.test(line);
}

suite('agentHostOrchestrationGuards (D12 / A4)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// -- I1: providerData is opaque to the host ----------------------------------

	suite('I1 providerData opacity', () => {

		const GUARDED = [
			'src/vs/platform/agentHost/node/agentService.ts',
			'src/vs/platform/agentHost/node/agentHostStateManager.ts',
		];

		test('no JSON.parse of providerData and no property/index access into the blob', () => {
			const violations: string[] = [];
			for (const rel of GUARDED) {
				violations.push(...findProviderDataOpacityViolations(rel, readSource(rel)));
			}
			assert.deepStrictEqual(violations, [], 'providerData must stay opaque to AgentService/AgentHostStateManager');
		});

		test('guard self-check: catches optional-chaining/index bypasses, ignores comment/string noise', () => {
			const flagged = [
				'const t = entry.providerData.threadId;',
				'const t = entry.providerData?.threadId;', // optional-chaining bypass
				'const t = entry.providerData ?. threadId;',
				'const t = entry.providerData[k];',
				'const t = JSON.parse(entry.providerData);',
			];
			for (const line of flagged) {
				assert.ok(findProviderDataOpacityViolations('fake.ts', line).length > 0, `guard must flag: ${line}`);
			}
			const clean = [
				'// const t = entry.providerData.threadId;', // comment noise
				'const s = "entry.providerData.threadId";', // string noise
				'const blob = entry.providerData;', // reading the blob field itself is fine
				'const blob = entry.providerData ?? undefined;',
				'providerData.get(k)', // the local Map named `providerData` is fine
			];
			for (const line of clean) {
				assert.deepStrictEqual(findProviderDataOpacityViolations('fake.ts', line), [], `guard must not flag: ${line}`);
			}
		});

		test('registerRestoredChatSummary round-trips the blob byte-for-byte into the resolver', async () => {
			const disposables = new DisposableStore();
			try {
				const manager = disposables.add(new AgentHostStateManager(new NullLogService()));
				const sessionUri = URI.from({ scheme: 'codex', path: '/sess_i1' }).toString();
				const summary: SessionSummary = {
					resource: sessionUri,
					provider: 'codex',
					title: 'I1',
					status: SessionStatus.Idle,
					createdAt: new Date(0).toISOString(),
					modifiedAt: new Date(0).toISOString(),
					project: { uri: 'file:///p', displayName: 'p' },
					lifecycle: SessionLifecycle.Ready,
				} as SessionSummary;
				manager.restoreSession(summary, []);
				const chatUri = URI.parse(buildDefaultChatUri(sessionUri).replace('default', 'peer1'));
				const blob = '{"thread":"thr_x","zero":0,"unicode":"héllo 世界","nested":{"a":[1,2,null]}}';
				let resolverSaw: string | undefined;
				let resolverCalls = 0;
				manager.registerRestoredChatSummary(sessionUri as never, chatUri, {
					providerData: blob,
					resolver: async providerData => {
						resolverCalls++;
						resolverSaw = providerData;
						return { turns: [], draft: undefined };
					},
				});
				await manager.resolveChatState(chatUri);
				assert.strictEqual(resolverCalls, 1);
				assert.strictEqual(resolverSaw, blob, 'the provider blob reaches the provider byte-identical — host never parsed or rebuilt it');
			} finally {
				disposables.dispose();
			}
		});
	});

	// -- I2: session URIs and chat channel URIs never mix -------------------------

	suite('I2 URI discipline', () => {

		test('buildDefaultChatUri ↔ parseDefaultChatUri roundtrip', () => {
			const sessions = [
				'vscode-agent-session://copilot/abc',
				'codex:/thread_123',
				URI.from({ scheme: 'codex', path: '/thread with spaces/✓' }).toString(),
			];
			for (const session of sessions) {
				const chatUri = buildDefaultChatUri(session);
				assert.ok(isAhpChatChannel(chatUri), `${chatUri} must be recognized as a chat channel`);
				assert.strictEqual(parseDefaultChatUri(chatUri), URI.parse(session).toString(), 'roundtrip recovers the session URI');
				assert.strictEqual(parseChatUri(chatUri)?.chatId, 'default');
			}
		});

		test('property-based: random session URIs are never classified as chat channels, and roundtrip holds', () => {
			// Deterministic PRNG — an LCG (Numerical Recipes constants), not mulberry32 — property-based without flakiness.
			let seed = 0xD12;
			const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
			const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&\'()*+,;=% 世界✓';
			const schemes = ['vscode-agent-session', 'codex', 'copilot', 'claude', 'file', 'https'];
			for (let i = 0; i < 500; i++) {
				const scheme = schemes[Math.floor(rand() * schemes.length)];
				const len = 1 + Math.floor(rand() * 40);
				let path = '';
				for (let j = 0; j < len; j++) {
					path += alphabet[Math.floor(rand() * alphabet.length)];
				}
				const sessionUri = URI.from({ scheme, path: `/p${path}` }).toString();
				assert.strictEqual(isAhpChatChannel(sessionUri), false, `session URI misclassified as chat channel: ${sessionUri}`);
				const chatUri = buildDefaultChatUri(sessionUri);
				assert.ok(isAhpChatChannel(chatUri));
				assert.strictEqual(parseDefaultChatUri(chatUri), sessionUri, `roundtrip broke for ${sessionUri}`);
			}
		});

		test('garbage is rejected, never misclassified', () => {
			for (const garbage of ['', 'ahp-chat://', 'not a uri', 'ahp-chat://default', '://', 'ahp-chat://default/!!!not-base64!!!']) {
				assert.strictEqual(parseDefaultChatUri(garbage), undefined, `'${garbage}' must not parse`);
			}
		});

		test('ahp-chat scheme collision vectors', () => {
			// `ahp-chat` is RESERVED for chat channels: classification is by
			// scheme alone, so any URI carrying it IS a chat channel and no
			// session provider may ever adopt it as a session scheme.
			assert.strictEqual(isAhpChatChannel('ahp-chat://some-session/x'), true,
				'ahp-chat is reserved: any URI with this scheme classifies as a chat channel');
			// A session URI that merely EMBEDS a chat URI in its path is not a
			// chat channel — the scheme, not the content, classifies.
			const nesting = URI.from({ scheme: 'codex', path: '/ahp-chat://default/abc' }).toString();
			assert.strictEqual(isAhpChatChannel(nesting), false, 'an embedded ahp-chat path must not misclassify the outer session URI');
			const chatUri = buildDefaultChatUri(nesting);
			assert.ok(isAhpChatChannel(chatUri));
			assert.strictEqual(parseDefaultChatUri(chatUri), nesting, 'roundtrip recovers the nesting session URI verbatim');
			// Even a chat URI wrapping another chat URI unwraps exactly one level.
			const inner = buildDefaultChatUri('codex:/thread_1');
			const outer = buildDefaultChatUri(inner);
			assert.strictEqual(parseDefaultChatUri(outer), inner, 'one unwrap level');
			assert.strictEqual(parseDefaultChatUri(parseDefaultChatUri(outer)!), 'codex:/thread_1', 'two unwrap levels recover the session');
		});
	});

	// -- I3: no sessionId === threadId assumption in Codex chat resolution --------

	suite('I3 explicit backing (codex)', () => {

		interface IResolverHarness {
			readonly id: 'codex';
			readonly _sessionIdByChatUri: Map<string, string>;
		}

		function resolveConversationSession(harness: IResolverHarness, address: URI): URI | undefined {
			const fn = (CodexAgent.prototype as unknown as {
				_resolveConversationSession(this: IResolverHarness, address: URI): URI | undefined;
			})._resolveConversationSession;
			assert.strictEqual(typeof fn, 'function', 'CodexAgent._resolveConversationSession must exist');
			return fn.call(harness, address);
		}

		test('a chat URI whose embedded session id matches NO thread id resolves only via the recorded binding', () => {
			const harness: IResolverHarness = { id: 'codex', _sessionIdByChatUri: new Map() };
			// Session identity and thread identity deliberately differ (Codex:
			// sessionId !== threadId; the backing is restored from the binding, not
			// derived from the URI).
			const sessionUri = AgentSession.uri('codex', 'host-session-42');
			const chat = URI.parse(buildDefaultChatUri(sessionUri.toString()));
			// Unbound: refuse — never fall back to assuming the URI names the thread.
			assert.strictEqual(resolveConversationSession(harness, chat), undefined, 'unbound chat must not resolve by URI identity');
			// Bound to a DIFFERENT runtime id than the URI spells: binding wins.
			harness._sessionIdByChatUri.set(chat.toString(), 'codex-thread-xyz');
			assert.strictEqual(resolveConversationSession(harness, chat)?.toString(), AgentSession.uri('codex', 'codex-thread-xyz').toString());
		});
	});

	// -- I4: single catalog entry + DR1 spawn ordering -----------------------------

	suite('I4 single catalog path', () => {

		test('_chatEntries writers are exactly the baseline set', () => {
			const rel = 'src/vs/platform/agentHost/node/agentHostStateManager.ts';
			const source = readSource(rel);
			const methods = methodPerLine(source);
			const writers = new Set<string>();
			source.split('\n').forEach((rawLine, i) => {
				if (isChatEntriesWrite(stripLineNoise(rawLine))) {
					writers.add(methods[i]);
				}
			});
			const baseline = JSON.parse(readSource('src/vs/platform/agentHost/test/node/baselines/d12-i4-chat-entries-writers.json')) as { allowedWriters: string[] };
			const allowed = new Set(baseline.allowedWriters);
			const added = [...writers].filter(w => !allowed.has(w));
			const removed = baseline.allowedWriters.filter(w => !writers.has(w));
			assert.deepStrictEqual(added, [], `new _chatEntries writer(s) bypass the single catalog path: ${added.join(', ')} — route through addChat/registerRestoredChatSummary/removeChat`);
			assert.deepStrictEqual(removed, [], `baseline entry no longer writes _chatEntries: ${removed.join(', ')} — shrink the baseline file`);
		});

		test('guard self-check: catches whole-map reassignment and index writes, ignores comment noise', () => {
			const flagged = [
				'this._chatEntries.set(key, entry);',
				'this._chatEntries.delete(key);',
				'this._chatEntries.clear();',
				'this._chatEntries[key] = entry;',
				'this._chatEntries = new Map();', // whole-map reassignment bypass
				'this._chatEntries  =  restoreFromDisk();',
			];
			for (const line of flagged) {
				assert.ok(isChatEntriesWrite(stripLineNoise(line)), `guard must flag: ${line}`);
			}
			const clean = [
				'// this._chatEntries.set(key, entry);', // comment noise
				'const s = "this._chatEntries.set(k, v)";', // string noise
				'this._chatEntries.get(key);',
				'if (this._chatEntries === other) {', // comparison is not a write
				'return this._chatEntries.size;',
				'private readonly _chatEntries = new Map<string, IChatEntry>();', // field declaration is not a write
			];
			for (const line of clean) {
				assert.ok(!isChatEntriesWrite(stripLineNoise(line)), `guard must not flag: ${line}`);
			}
		});

		test('DR1: the spawn-sequencing listener is registered before the AgentSideEffects listener', () => {
			const rel = 'src/vs/platform/agentHost/node/agentService.ts';
			const source = readSource(rel);
			const initStart = source.indexOf('private _initializeProvider(');
			assert.ok(initStart > 0, '_initializeProvider not found');
			const initBody = source.slice(initStart);
			const spawnIdx = initBody.indexOf('provider.onDidChatProgress(signal => this._sequenceSpawnedChat(signal))');
			const sideEffectsIdx = initBody.indexOf('this._sideEffects.registerProgressListener(provider)');
			assert.ok(spawnIdx > 0, 'spawn-sequencing listener registration not found');
			assert.ok(sideEffectsIdx > 0, 'AgentSideEffects listener registration not found');
			assert.ok(spawnIdx < sideEffectsIdx, 'DR1 violated: the spawn channel must be armed before AgentSideEffects sees the same signal');
		});
	});

	// -- I6: providers never read the association map directly ---------------------

	suite('I6 provider routing', () => {

		test('no provider slice references the session→provider association map', () => {
			const violations: string[] = [];
			for (const slice of ['codex', 'claude', 'copilot']) {
				const dir = `${AGENT_HOST_NODE}/${slice}`;
				let files: string[] = [];
				try {
					files = listTsRecursive(dir);
				} catch {
					continue;
				}
				for (const file of files) {
					if (file.includes('/protocol/generated/')) {
						continue;
					}
					const source = readFileSync(file, 'utf8');
					source.split('\n').forEach((line, i) => {
						if (/_sessionToProvider/.test(line) || /agentHostProviderService\.js/.test(line)) {
							violations.push(`${file}:${i + 1}`);
						}
					});
				}
			}
			assert.deepStrictEqual(violations, [], 'providers must route through IAgentHostProviderService, never read the association map');
		});
	});

	// -- I8: providers consume host facts, never the state manager -----------------

	suite('I8 state-manager isolation (baseline-gated)', () => {

		test('node/codex/** references to AgentHostStateManager match the baseline exactly', () => {
			const baseline = JSON.parse(readSource('src/vs/platform/agentHost/test/node/baselines/d12-i8-codex-host-state-imports.json')) as { allowedViolations: string[] };
			const allowed = new Set(baseline.allowedViolations);
			const found = new Set<string>();
			const dir = `${AGENT_HOST_NODE}/codex`;
			for (const file of listTsRecursive(dir)) {
				if (file.includes('/protocol/generated/')) {
					continue;
				}
				const source = readFileSync(file, 'utf8');
				if (/AgentHostStateManager/.test(source) || /agentHostStateManager\.js/.test(source)) {
					found.add(file.slice(REPO_ROOT.length));
				}
			}
			const newViolations = [...found].filter(f => !allowed.has(f));
			const staleBaseline = baseline.allowedViolations.filter(f => !found.has(f));
			assert.deepStrictEqual(newViolations, [], `NEW I8 violations — codex provider code must consume typed host seams, not AgentHostStateManager: ${newViolations.join(', ')}`);
			assert.deepStrictEqual(staleBaseline, [], `baseline entries resolved — shrink the baseline file: ${staleBaseline.join(', ')}`);
		});
	});
});
