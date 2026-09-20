/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createRequire } from 'module';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

/**
 * D12 / Issue #14 — A2.1 item-pairing scanner + A3.1 pending-request drain scan.
 *
 * Offline (no network, no app-server): every committed Codex model capture
 * (`e2e/captures/codex-*.yaml`) is scanned for item lifecycle pairing — each
 * `tool_use` the model issued must be answered by a `tool_result` in a later
 * request, unless it belongs to the recording's final exchange (the turn
 * terminal cleanup window). Every committed AHP traffic snapshot
 * (`*.traffic.ahp.yaml`, all providers) is additionally scanned at the
 * protocol projection: `chat/toolCallStart` ↔ `chat/toolCallComplete` pairing,
 * and no pending confirmation may survive its turn's terminal event.
 */

const nodeRequire = createRequire(import.meta.url);
const yamlModule = nodeRequire('js-yaml') as { load(input: string): unknown };

const E2E_DIR = fileURLToPath(new URL('../../../../../../../src/vs/platform/agentHost/test/node/e2e/', import.meta.url));

// ---- Capture model (see e2e/harness/capiWireCodec.ts) ------------------------

interface ICaptureContentItem {
	readonly type: string;
	readonly id?: string;
	readonly tool_use_id?: string;
}

interface ICaptureMessage {
	readonly role: string;
	readonly content?: string | readonly ICaptureContentItem[];
}

interface ICaptureExchange {
	readonly request?: { readonly messages?: readonly ICaptureMessage[] };
	readonly response?: { readonly content?: string | readonly ICaptureContentItem[]; readonly stopReason?: string };
}

interface ICapture {
	readonly exchanges?: readonly ICaptureExchange[];
}

function contentItems(content: string | readonly ICaptureContentItem[] | undefined): readonly ICaptureContentItem[] {
	return Array.isArray(content) ? content : [];
}

// ---- AHP snapshot model ------------------------------------------------------

interface IAhpAction {
	readonly type: string;
	readonly turnId?: string;
	readonly toolCallId?: string;
}

interface IAhpEnvelope {
	readonly channel?: string;
	readonly action?: IAhpAction;
}

interface IAhpRound {
	readonly clientToServer?: readonly IAhpEnvelope[];
	readonly serverToClient?: readonly IAhpEnvelope[];
}

interface IAhpSnapshot {
	readonly rounds?: readonly IAhpRound[];
}

function yamlFiles(dir: string, suffix: string): string[] {
	try {
		return readdirSync(dir).filter(f => f.endsWith(suffix)).sort();
	} catch {
		return [];
	}
}

suite('codexCaptureInvariantScanner (D12 / A2.1, A3.1 replay scan)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// -- A2.1a: model-capture tool_use ↔ tool_result pairing ----------------------

	suite('A2.1 capture pairing (all codex captures)', () => {
		const capturesDir = `${E2E_DIR}captures`;
		const captures = yamlFiles(capturesDir, '.yaml').filter(f => f.startsWith('codex-'));
		const nonCodex = yamlFiles(capturesDir, '.yaml').filter(f => !f.startsWith('codex-'));

		test('scanner sees the full corpus', () => {
			assert.ok(captures.length >= 100, `expected the committed codex capture corpus, found ${captures.length}`);
			assert.ok(nonCodex.length > 0, 'non-codex captures are included in the scan');
		});

		test('every capture: every tool_use is paired with a tool_result (or ends in the terminal cleanup window)', function () {
			// One test, not 150+ registered cases: keeps mocha registration and
			// heap churn out of the shared unit-test process while still failing
			// with the exact file list.
			const failures: string[] = [];
			for (const file of [...captures, ...nonCodex]) {
				const capture = yamlModule.load(readFileSync(`${capturesDir}/${file}`, 'utf8')) as ICapture;
				const exchanges = capture.exchanges ?? [];
				const problems: string[] = [];
				// tool_result ids are cumulative across requests (the conversation
				// history grows), so an id answered anywhere after issuance pairs.
				const answered = new Set<string>();
				const open: { id: string; exchange: number }[] = [];
				exchanges.forEach((exchange, i) => {
					for (const message of exchange.request?.messages ?? []) {
						for (const item of contentItems(message.content)) {
							if (item.type === 'tool_result' && item.tool_use_id) {
								answered.add(item.tool_use_id);
							}
						}
					}
					for (const item of contentItems(exchange.response?.content)) {
						if (item.type === 'tool_use' && item.id) {
							if (!answered.has(item.id)) {
								open.push({ id: item.id, exchange: i });
							}
						}
					}
				});
				for (const pending of open) {
					if (answered.has(pending.id)) {
						continue;
					}
					// The only legal residue: the tool was issued by the recording's
					// FINAL exchange — the capture ended before the item completed
					// (turn terminal cleanup window). Anything earlier means the
					// conversation continued while an item never completed.
					if (pending.exchange !== exchanges.length - 1) {
						problems.push(`tool_use '${pending.id}' issued in exchange ${pending.exchange} never received a tool_result, and the conversation continued`);
					}
				}
				if (problems.length > 0) {
					failures.push(`${file}: ${problems.join('; ')}`);
				}
			}
			assert.deepStrictEqual(failures, [], 'unpaired items');
		});
	});

	// -- A2.1b + A3.1: AHP projection pairing and pending drain -------------------

	suite('AHP traffic snapshot pairing (all providers)', () => {
		const snapshotDirs = [`${E2E_DIR}providers/__snapshots__`, `${E2E_DIR}conformance/__snapshots__`];
		const snapshots = snapshotDirs.flatMap(dir => yamlFiles(dir, '.traffic.ahp.yaml').map(f => ({ dir, file: f })));

		test('scanner sees the committed snapshot corpus', () => {
			assert.ok(snapshots.length >= 50, `expected the committed AHP snapshot corpus, found ${snapshots.length}`);
		});

		test('every snapshot: toolCallStart/Complete pair and no pending confirmation survives a terminal turn', function () {
			const failures: string[] = [];
			for (const { dir, file } of snapshots) {
				const snapshot = yamlModule.load(readFileSync(`${dir}/${file}`, 'utf8')) as IAhpSnapshot;
				const problems: string[] = [];
				// Per (channel, turn): started ids, completed ids, terminated flag.
				interface ITurnBucket {
					started: Set<string>;
					completed: Set<string>;
					terminated: boolean;
				}
				const turns = new Map<string, ITurnBucket>();
				const bucket = (channel: string, turnId: string): ITurnBucket => {
					const key = `${channel}${turnId}`;
					let b = turns.get(key);
					if (!b) {
						b = { started: new Set(), completed: new Set(), terminated: false };
						turns.set(key, b);
					}
					return b;
				};
				// Pending confirmations (toolCallReady without confirmed) per id.
				const readyNotConfirmed = new Set<string>();
				const confirmed = new Set<string>();
				for (const round of snapshot.rounds ?? []) {
					for (const direction of [round.clientToServer ?? [], round.serverToClient ?? []]) {
						for (const envelope of direction) {
							const action = envelope.action;
							if (!action?.turnId) {
								continue;
							}
							const b = bucket(envelope.channel ?? '', action.turnId);
							switch (action.type) {
								case 'chat/toolCallStart':
									if (action.toolCallId) {
										b.started.add(action.toolCallId);
									}
									break;
								case 'chat/toolCallComplete':
									if (action.toolCallId) {
										b.completed.add(action.toolCallId);
									}
									break;
								case 'chat/toolCallReady':
									if (action.toolCallId) {
										readyNotConfirmed.add(action.toolCallId);
									}
									break;
								case 'chat/toolCallConfirmed':
									if (action.toolCallId) {
										confirmed.add(action.toolCallId);
									}
									break;
								case 'chat/turnComplete':
								case 'chat/turnCancelled':
									b.terminated = true;
									break;
							}
						}
					}
				}
				for (const [key, b] of turns) {
					const unpaired = [...b.started].filter(id => !b.completed.has(id));
					if (unpaired.length > 0 && b.terminated) {
						problems.push(`turn ${key}: tool calls started but never completed past the terminal event: ${unpaired.join(', ')}`);
					}
					if (b.terminated) {
						const dangling = [...readyNotConfirmed].filter(id => b.started.has(id) && !confirmed.has(id) && !b.completed.has(id));
						if (dangling.length > 0) {
							problems.push(`turn ${key}: confirmations still pending at terminal event: ${dangling.join(', ')}`);
						}
					}
				}
				if (problems.length > 0) {
					failures.push(`${file}: ${problems.join('; ')}`);
				}
			}
			assert.deepStrictEqual(failures, [], 'pairing/pending violations');
		});
	});
});
