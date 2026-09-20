/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PassThrough } from 'stream';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	CodexAppServerClient,
	JsonRpcError,
	JsonRpcErrorCode,
	type ICodexAppServerTransport,
} from '../../../node/codex/codexAppServerClient.js';

// #region In-memory fake transport
//
// Two `PassThrough` streams paired so the test's "peer" side reads what
// the client writes, and vice versa. Mirrors the shape of a real spawned
// process from the client's perspective.

interface IFakePeer {
	readonly transport: ICodexAppServerTransport;
	/** Lines the client wrote (sent to the server). */
	readonly outbound: PassThrough;
	readonly killCount: number;
	/** Inject a wire message from server → client. Newline-terminated. */
	push(message: object): void;
	/** Simulate the codex process exiting. */
	exit(code: number | null, signal?: NodeJS.Signals | null): void;
	dispose(): void;
}

function makeFakePeer(): IFakePeer {
	const clientStdin = new PassThrough();   // client writes here, peer reads
	const clientStdout = new PassThrough();  // peer writes here, client reads
	const exitEmitter = new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();
	const onceExitListeners: ((e: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void)[] = [];
	let killed = false;
	let killCount = 0;
	const fireExit = (e: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => {
		exitEmitter.fire(e);
		for (const listener of onceExitListeners.splice(0)) {
			listener(e);
		}
	};

	const transport: ICodexAppServerTransport = {
		stdin: clientStdin,
		stdout: clientStdout,
		kill(_signal) {
			killCount++;
			if (killed) {
				return false;
			}
			killed = true;
			fireExit({ code: null, signal: _signal ?? null });
			return true;
		},
		onExit: exitEmitter.event,
		onExitOnce(listener) {
			onceExitListeners.push(listener);
		},
	};

	return {
		transport,
		outbound: clientStdin,
		get killCount() { return killCount; },
		push(message: object) {
			clientStdout.write(JSON.stringify(message) + '\n');
		},
		exit(code, signal = null) {
			fireExit({ code, signal });
		},
		dispose() {
			onceExitListeners.length = 0;
			exitEmitter.dispose();
			clientStdin.destroy();
			clientStdout.destroy();
		},
	};
}

/**
 * Consume newline-delimited JSON from a stream. Resolves with the next
 * complete message; rejects if `timeoutMs` elapses or the stream ends.
 */
function readNextMessage(stream: PassThrough, timeoutMs = 1_000): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let buf = '';
		const onData = (chunk: Buffer | string) => {
			buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			const nl = buf.indexOf('\n');
			if (nl < 0) {
				return;
			}
			const line = buf.slice(0, nl).trim();
			cleanup();
			try {
				resolve(JSON.parse(line));
			} catch (err) {
				reject(err);
			}
		};
		const onEnd = () => {
			cleanup();
			reject(new Error('stream ended before message arrived'));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error('timed out waiting for message'));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timer);
			stream.off('data', onData);
			stream.off('end', onEnd);
		};
		stream.on('data', onData);
		stream.on('end', onEnd);
	});
}

// #endregion

suite('CodexAppServerClient', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('request roundtrip resolves with typed result', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			// Issue a request and capture what's written on the wire.
			const responsePromise = client.request<'getAuthStatus'>('getAuthStatus', { refreshToken: false, includeToken: false });
			const sent = await readNextMessage(peer.outbound) as { id: number; method: string; params: unknown };
			assert.strictEqual(sent.method, 'getAuthStatus');
			assert.deepStrictEqual(sent.params, { refreshToken: false, includeToken: false });
			assert.strictEqual(typeof sent.id, 'number');

			// Reply with success.
			peer.push({ id: sent.id, result: { authMode: 'apikey' } });
			const result = await responsePromise as { authMode: string };
			assert.deepStrictEqual(result, { authMode: 'apikey' });
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('request includes W3C trace context when provided', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false }, {
				traceId: '1'.repeat(32),
				spanId: '2'.repeat(16),
				traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
				tracestate: 'vendor=value',
			});
			const sent = await readNextMessage(peer.outbound) as { id: number; trace: unknown };
			assert.deepStrictEqual(sent.trace, {
				traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
				tracestate: 'vendor=value',
			});
			peer.push({ id: sent.id, result: { authMode: 'apikey' } });
			await responsePromise;
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('request rejects with JsonRpcError on error envelope', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const sent = await readNextMessage(peer.outbound) as { id: number };
			peer.push({ id: sent.id, error: { code: JsonRpcErrorCode.InternalError, message: 'boom' } });
			await assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				assert.strictEqual(err.code, JsonRpcErrorCode.InternalError);
				assert.match(err.message, /boom/);
				return true;
			});
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('request response ids must match the numeric id exactly', async () => {
		const peer = makeFakePeer();
		const logs: { level: string; message: string }[] = [];
		const client = new CodexAppServerClient(peer.transport, (level, message) => logs.push({ level, message }));
		try {
			const responsePromise = client.request<'getAuthStatus'>('getAuthStatus', { refreshToken: false, includeToken: false });
			const sent = await readNextMessage(peer.outbound) as { id: number };

			peer.push({ id: String(sent.id), result: { authMode: 'apikey' } });
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(logs, [{ level: 'warn', message: `unsolicited response id=${sent.id}` }]);

			peer.push({ id: sent.id, result: { authMode: 'apikey' } });
			assert.deepStrictEqual(await responsePromise, { authMode: 'apikey' });
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('notify writes a payload with no id', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			client.notify('initialized', undefined as never);
			const sent = await readNextMessage(peer.outbound) as { id?: unknown; method: string; params?: unknown };
			assert.strictEqual(sent.method, 'initialized');
			assert.strictEqual(sent.id, undefined);
			assert.strictEqual(sent.params, undefined);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('server notification is delivered to registered handler', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const received: unknown[] = [];
			const handle = client.onNotification('thread/started', params => received.push(params));
			peer.push({ method: 'thread/started', params: { thread: { id: 'thr_x' } } });
			// Give the data event a tick.
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(received, [{ thread: { id: 'thr_x' } }]);
			handle.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('unhandled server notification is dropped with a warning', async () => {
		const peer = makeFakePeer();
		const logs: { level: string; message: string }[] = [];
		const client = new CodexAppServerClient(peer.transport, (level, message) => logs.push({ level, message }));
		try {
			let invoked = false;
			const handle = client.onNotification('thread/started', () => { invoked = true; });
			peer.push({ method: 'made-up/method', params: { anything: 1 } });
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual({ invoked, logs }, {
				invoked: false,
				logs: [{ level: 'warn', message: 'dropping unhandled notification: made-up/method' }],
			});
			handle.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('server request without handler returns MethodNotFound', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			peer.push({ id: 99, method: 'item/tool/requestUserInput', params: { questions: [] } });
			const reply = await readNextMessage(peer.outbound) as { id: number; error: { code: number; message: string } };
			assert.strictEqual(reply.id, 99);
			assert.strictEqual(reply.error.code, JsonRpcErrorCode.MethodNotFound);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('server request with handler returns result envelope', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const handle = client.onRequest('item/tool/requestUserInput', _params => ({
				result: { answers: { test: { answers: ['ok'] } } },
			}));
			peer.push({ id: 7, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'test', label: 'go?' }] } });
			const reply = await readNextMessage(peer.outbound) as { id: number; result: unknown };
			assert.strictEqual(reply.id, 7);
			assert.deepStrictEqual(reply.result, { answers: { test: { answers: ['ok'] } } });
			handle.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('server request handler throwing is converted to InternalError', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const handle = client.onRequest('item/tool/requestUserInput', () => {
				throw new Error('boom');
			});
			peer.push({ id: 8, method: 'item/tool/requestUserInput', params: { questions: [] } });
			const reply = await readNextMessage(peer.outbound) as { id: number; error: { code: number; message: string } };
			assert.strictEqual(reply.error.code, JsonRpcErrorCode.InternalError);
			assert.match(reply.error.message, /boom/);
			handle.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('process exit rejects in-flight requests', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			// Consume the outbound write so the request is fully dispatched.
			await readNextMessage(peer.outbound);
			peer.exit(1);
			await assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				return true;
			});
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('dispose rejects pending requests with CancellationError', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
		await readNextMessage(peer.outbound);
		client.dispose();
		await assert.rejects(responsePromise, (err: unknown) => err instanceof CancellationError);
		peer.dispose();
	});

	test('dispose cancels grace kill when transport exits cleanly', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport, undefined, 1);
		client.dispose();
		peer.exit(0);
		await new Promise(resolve => setTimeout(resolve, 5));
		assert.strictEqual(peer.killCount, 0);
		peer.dispose();
	});

	test('handles multiple messages arriving in a single chunk', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const received: string[] = [];
			const h1 = client.onNotification('thread/started', () => received.push('a'));
			const h2 = client.onNotification('turn/started', () => received.push('b'));
			// Two NDJSON lines in one chunk.
			peer.transport.stdout.emit('data', JSON.stringify({ method: 'thread/started', params: { thread: { id: 't' } } }) + '\n' + JSON.stringify({ method: 'turn/started', params: { turn: { id: 'x' } } }) + '\n');
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(received, ['a', 'b']);
			h1.dispose();
			h2.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('partial line is buffered until newline arrives', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		try {
			const received: unknown[] = [];
			const handle = client.onNotification('thread/started', params => received.push(params));
			const json = JSON.stringify({ method: 'thread/started', params: { thread: { id: 'split' } } }) + '\n';
			peer.transport.stdout.emit('data', json.slice(0, 10));
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(received, []);
			peer.transport.stdout.emit('data', json.slice(10));
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(received, [{ thread: { id: 'split' } }]);
			handle.dispose();
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	// #region D13 crash / backpressure / replacement negatives (issue #15)

	test('process exit rejects every in-flight request and later requests fail without touching the wire (C2.1/B5)', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		let wire = '';
		peer.outbound.on('data', chunk => { wire += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); });
		const wireLines = () => wire.split('\n').filter(line => line.trim().length > 0).length;
		try {
			// Park three concurrent requests, then SIGKILL the peer. `request`
			// writes synchronously, so all three are on the wire immediately.
			const first = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const second = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const third = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));
			assert.strictEqual(wireLines(), 3, 'three requests must reach the wire');

			peer.exit(null, 'SIGKILL');

			await Promise.all([first, second, third].map(pending => assert.rejects(pending, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				assert.strictEqual(err.code, JsonRpcErrorCode.InternalError);
				assert.match(err.message, /SIGKILL/);
				assert.match(err.message, /aborted/);
				return true;
			})));

			// A post-exit request rejects immediately and never reaches the wire.
			await assert.rejects(
				client.request('getAuthStatus', { refreshToken: false, includeToken: false }),
				(err: unknown) => err instanceof JsonRpcError && err.code === JsonRpcErrorCode.InternalError,
			);
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));
			assert.strictEqual(wireLines(), 3, 'no request may be written to a dead transport');
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('dispose force-kills a peer that ignores the stdin EOF grace period (D16/A1.4)', async () => {
		// A peer that never exits on its own: dispose() must escalate to SIGKILL.
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const exitEmitter = new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();
		const killSignals: (NodeJS.Signals | undefined)[] = [];
		const transport: ICodexAppServerTransport = {
			stdin,
			stdout,
			kill: signal => { killSignals.push(signal); return true; },
			onExit: exitEmitter.event,
			onExitOnce: () => { },
		};
		const client = new CodexAppServerClient(transport, undefined, 10);
		client.dispose();
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.deepStrictEqual(killSignals, ['SIGKILL'], 'dispose must SIGKILL a peer that ignores EOF');
		exitEmitter.dispose();
		stdin.destroy();
		stdout.destroy();
	});

	test('a response arriving after process exit is dropped without crashing (B7)', async () => {
		const peer = makeFakePeer();
		const logs: { level: string; message: string }[] = [];
		const client = new CodexAppServerClient(peer.transport, (level, message) => logs.push({ level, message }));
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const sent = await readNextMessage(peer.outbound) as { id: number };
			peer.exit(1);
			await assert.rejects(responsePromise);

			// The late result of the killed process must not resolve anything.
			peer.push({ id: sent.id, result: { authMode: 'apikey' } });
			await new Promise(r => setImmediate(r));
			assert.deepStrictEqual(logs, [{ level: 'warn', message: `unsolicited response id=${sent.id}` }]);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	// #region Overloaded (-32001) bounded retry (issue #31, D13/B8 positive half)

	/**
	 * Attach a raw wire listener and return helpers to inspect every
	 * request the client has written so far.
	 */
	function watchWire(peer: IFakePeer) {
		let wire = '';
		peer.outbound.on('data', chunk => { wire += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); });
		const requests = () => wire.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => JSON.parse(line) as { id: number; method?: string })
			.filter(msg => typeof msg.id === 'number' && typeof msg.method === 'string');
		return { requests };
	}

	/**
	 * Auto-respond to every request the client writes with a -32001
	 * overloaded error. Returns the recorded request ids in arrival order.
	 */
	function autoRespondOverloaded(peer: IFakePeer): { readonly ids: number[]; readonly times: number[] } {
		const ids: number[] = [];
		const times: number[] = [];
		let buf = '';
		peer.outbound.on('data', chunk => {
			buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			let nl: number;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (line.length === 0) {
					continue;
				}
				const msg = JSON.parse(line) as { id?: number; method?: string };
				if (typeof msg.id === 'number' && typeof msg.method === 'string') {
					ids.push(msg.id);
					times.push(Date.now());
					peer.push({ id: msg.id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
				}
			}
		});
		return { ids, times };
	}

	test('a -32001 on a retryable read is retried with backoff and resolves once the server recovers', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 20,
			backoffFactor: 2,
			jitterRatio: 0,
			maxRetries: 3,
			totalBudgetMs: 5_000,
			random: () => 0.5,
		});
		const { requests } = watchWire(peer);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await new Promise(r => setImmediate(r));
			assert.strictEqual(requests().length, 1);

			// First attempt overloaded → client waits, then retries on its own.
			peer.push({ id: requests()[0].id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
			await new Promise(resolve => setTimeout(resolve, 150));
			assert.strictEqual(requests().length, 2, 'exactly one automatic retry was sent');
			assert.notStrictEqual(requests()[1].id, requests()[0].id, 'the retry uses a fresh request id');

			// Server recovers: the retry resolves the original caller promise.
			peer.push({ id: requests()[1].id, result: { authMode: 'apikey' } });
			assert.deepStrictEqual(await responsePromise, { authMode: 'apikey' });
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('overloaded retries are bounded and the final -32001 surfaces verbatim', async () => {
		const peer = makeFakePeer();
		const logs: { level: string; message: string }[] = [];
		const client = new CodexAppServerClient(peer.transport, (level, message) => logs.push({ level, message }), undefined, {
			initialDelayMs: 10,
			backoffFactor: 2,
			jitterRatio: 0,
			maxRetries: 2,
			totalBudgetMs: 5_000,
			random: () => 0.5,
		});
		const traffic = autoRespondOverloaded(peer);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				assert.strictEqual(err.code, -32001);
				assert.match(err.message, /Server overloaded; retry later\./);
				return true;
			});
			assert.strictEqual(traffic.ids.length, 3, 'initial attempt + exactly 2 bounded retries reached the wire');
			assert.ok(logs.some(l => l.level === 'warn' && /retry 1\/2/.test(l.message)), 'a retry warning is logged');
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('overloaded retry delays grow exponentially and stay within jitter bounds', async () => {
		const peer = makeFakePeer();
		// random() === 1 → maximum jitter multiplier (1 + jitterRatio).
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 40,
			backoffFactor: 2,
			jitterRatio: 0.5,
			maxRetries: 2,
			totalBudgetMs: 10_000,
			random: () => 1,
		});
		const traffic = autoRespondOverloaded(peer);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await assert.rejects(responsePromise);
			assert.strictEqual(traffic.times.length, 3);
			const gap1 = traffic.times[1] - traffic.times[0];
			const gap2 = traffic.times[2] - traffic.times[1];
			// Expected: 40 * 1.5 = 60ms, then 80 * 1.5 = 120ms. Generous
			// tolerances for slow CI, but the 2x growth must be visible.
			assert.ok(gap1 >= 50 && gap1 <= 250, `first gap ${gap1}ms within [50, 250]`);
			assert.ok(gap2 >= 100 && gap2 <= 500, `second gap ${gap2}ms within [100, 500]`);
			assert.ok(gap2 > gap1, `delays grow: ${gap1}ms < ${gap2}ms`);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('overloaded retry fires at most 3 retries within 100ms even with an aggressive policy (B8: no dense retry storm)', async () => {
		const peer = makeFakePeer();
		// Worst-case jitter (random() === 0 → multiplier 1 - jitterRatio)
		// with the smallest policy the tests use: 25ms * 2^n, jittered down
		// to [12.5, 25, 50, 100, ...]ms → cumulative retry times 12.5, 37.5,
		// 87.5, 187.5, ... → at most 3 retries land inside any 100ms window.
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 25,
			backoffFactor: 2,
			jitterRatio: 0.5,
			maxRetries: 10,
			totalBudgetMs: 60_000,
			random: () => 0,
		});
		const traffic = autoRespondOverloaded(peer);
		const t0 = Date.now();
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await new Promise(resolve => setTimeout(resolve, 100));
			const withinWindow = traffic.times.filter(t => t - t0 <= 100);
			// The first entry is the initial attempt, not a retry.
			assert.ok(withinWindow.length - 1 <= 3, `at most 3 retries within 100ms (got ${withinWindow.length - 1})`);
			// The remaining backoff delays would exceed the test timeout;
			// dispose to settle the loop instead of waiting out the policy.
			client.dispose();
			await assert.rejects(responsePromise);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('overloaded retry stops when the total budget would be exceeded', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 20,
			backoffFactor: 10,
			jitterRatio: 0,
			maxRetries: 10,
			totalBudgetMs: 100,
			random: () => 0.5,
		});
		const traffic = autoRespondOverloaded(peer);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			await assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError && err.code === -32001);
				return true;
			});
			// First retry after 20ms fits the budget; the next delay (200ms)
			// would overshoot the 100ms budget and is never started.
			assert.strictEqual(traffic.ids.length, 2, 'only the retry that fits the budget is sent');
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('a -32001 on a side-effecting method (turn/start) is not auto-retried (B8/R8 idempotency ruling)', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 10,
			backoffFactor: 2,
			jitterRatio: 0,
			maxRetries: 4,
			totalBudgetMs: 5_000,
			random: () => 0.5,
		});
		const { requests } = watchWire(peer);
		try {
			const responsePromise = client.request('turn/start', { threadId: 't1', input: [] } as never);
			const responseRejection = assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				assert.strictEqual(err.code, -32001);
				assert.match(err.message, /Server overloaded; retry later\./);
				return true;
			});
			await new Promise(r => setImmediate(r));
			assert.strictEqual(requests().length, 1, 'exactly one request reaches the wire');
			peer.push({ id: requests()[0].id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
			await responseRejection;

			// No automatic retry for a non-idempotent method, even though the
			// policy allows retries: nothing more is written on its own.
			await new Promise(resolve => setTimeout(resolve, 150));
			assert.strictEqual(requests().length, 1, 'the client must not auto-retry turn/start');

			// Nor is the failure sticky: the caller decides when to retry.
			const retryPromise = client.request('turn/start', { threadId: 't1', input: [] } as never);
			await new Promise(r => setImmediate(r));
			assert.strictEqual(requests().length, 2, 'a caller-driven retry reaches the wire');
			peer.push({ id: requests()[1].id, result: {} });
			await assert.doesNotReject(retryPromise);
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	test('non-overloaded error codes are not retried even for retryable reads', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport, undefined, undefined, {
			initialDelayMs: 10,
			backoffFactor: 2,
			jitterRatio: 0,
			maxRetries: 4,
			totalBudgetMs: 5_000,
			random: () => 0.5,
		});
		const { requests } = watchWire(peer);
		try {
			const responsePromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const responseRejection = assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError && err.code === JsonRpcErrorCode.InternalError);
				return true;
			});
			await new Promise(r => setImmediate(r));
			peer.push({ id: requests()[0].id, error: { code: JsonRpcErrorCode.InternalError, message: 'boom' } });
			await responseRejection;
			await new Promise(resolve => setTimeout(resolve, 150));
			assert.strictEqual(requests().length, 1, 'permanent errors are not retried');
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	// #endregion

	test('a -32001 overloaded rejection on a non-retryable path surfaces verbatim and triggers no automatic retry (B8/R8)', async () => {
		const peer = makeFakePeer();
		const client = new CodexAppServerClient(peer.transport);
		// Collect raw wire traffic with a single stable listener; coalesced
		// writes are split on newlines.
		let wire = '';
		peer.outbound.on('data', chunk => { wire += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); });
		const sentLines = () => wire.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line) as { id: number; method?: string });
		try {
			// thread/archive is a side-effecting method outside the retry
			// allowlist, so its -32001 rejection stays fail-fast.
			const responsePromise = client.request('thread/archive', { threadId: 't1' } as never);
			const responseRejection = assert.rejects(responsePromise, (err: unknown) => {
				assert.ok(err instanceof JsonRpcError, 'expected JsonRpcError');
				assert.strictEqual(err.code, -32001);
				assert.match(err.message, /Server overloaded; retry later\./);
				return true;
			});
			await new Promise(r => setImmediate(r));
			const sent = sentLines();
			assert.strictEqual(sent.length, 1, 'exactly one request reaches the wire');
			const id = sent[0].id;

			peer.push({ id, error: { code: -32001, message: 'Server overloaded; retry later.' } });
			await responseRejection;

			// No immediate retry storm: nothing more may be written on its own.
			await new Promise(resolve => setTimeout(resolve, 100));
			assert.strictEqual(sentLines().length, 1, 'the client must not auto-retry an overloaded rejection');

			// Nor is the failure sticky: the caller decides when to retry.
			const retryPromise = client.request('getAuthStatus', { refreshToken: false, includeToken: false });
			const retryResult = assert.doesNotReject(retryPromise);
			await new Promise(r => setImmediate(r));
			const retried = sentLines().at(-1)!;
			peer.push({ id: retried.id, result: { authMode: 'apikey' } });
			await retryResult;
			assert.deepStrictEqual(await retryPromise, { authMode: 'apikey' });
		} finally {
			client.dispose();
			peer.dispose();
		}
	});

	// #endregion
});
