/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import { join } from '../../../../../base/common/path.js';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { CCAModel } from '@vscode/copilot-api';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../log/common/log.js';
import type { IProductService } from '../../../../product/common/productService.js';
import { CodexAgent, codexBinaryTriple, codexPackageSuffix } from '../../../node/codex/codexAgent.js';
import { CodexProxyService, ICodexProxyService, type ICodexProxyHandle } from '../../../node/codex/codexProxyService.js';
import type { ICopilotApiService } from '../../../node/shared/copilotApiService.js';

// Issue #39: `_startRawConnection` must not start the Copilot proxy — and
// therefore must not bind any loopback port — when there is no GitHub token.
// With a token, the proxy must be started exactly once and the launch config
// must point the `vscode-proxy` provider at it.
//
// These tests exercise the real `_startRawConnection` against a fake
// app-server binary (a node script that answers the `initialize` handshake)
// and the real `CodexProxyService`, asserting on the process's live listening
// sockets (the same `_getActiveHandles` approach as codexProxyService.test.ts).

// #region Fakes

class FakeCopilotApiService implements ICopilotApiService {
	declare readonly _serviceBrand: undefined;

	async resolveRestrictedTelemetryContext() { return { restrictedTelemetryEnabled: false, trackingId: undefined, telemetryEndpoint: undefined }; }
	async resolveApiEndpoint() { return undefined; }
	messages(): never { throw new Error('not used by proxy gating tests'); }
	async countTokens(): Promise<never> { throw new Error('not used by proxy gating tests'); }
	async models(): Promise<CCAModel[]> { return []; }
	async responses(): Promise<Response> { throw new Error('not used by proxy gating tests'); }
	async utilityChatCompletion(): Promise<never> { throw new Error('not used by proxy gating tests'); }
}

/** Minimal structural view of the agent state `_startRawConnection` reads. */
interface IStartRawHarness {
	_githubToken: string | undefined;
	readonly _codexProxyService: ICodexProxyService;
	readonly _logService: NullLogService;
	readonly _otelService: { getNativeSdkTelemetryConfig(): Promise<undefined> };
	/** Optional: the branded-build product shape (`excludeCopilotFromPackaging: true`). Absent = dev/default build. */
	readonly _productService?: IProductService;
	_resolveSdkRoot(): Promise<string>;
}

interface IRawConnectionResult {
	readonly client: { dispose(): void };
	readonly proxyHandle: ICodexProxyHandle | undefined;
	readonly child: ChildProcessWithoutNullStreams;
}

type StartRawConnectionFn = (this: IStartRawHarness, initializationTimeoutMs?: number) => Promise<IRawConnectionResult>;

const startRawConnection = (CodexAgent.prototype as unknown as { _startRawConnection: StartRawConnectionFn })._startRawConnection;

const DUMP_ENV_VAR = 'VSCODE_FAKE_CODEX_DUMP';

/**
 * A stand-in for the native codex binary: records its argv and the env the
 * launch config produced, then answers the `initialize` handshake and idles
 * until stdin closes.
 */
const FAKE_CODEX_SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const dumpPath = process.env[${JSON.stringify(DUMP_ENV_VAR)}];
if (dumpPath) {
	fs.writeFileSync(dumpPath, JSON.stringify({ args: process.argv.slice(2), openaiApiKey: process.env.OPENAI_API_KEY ?? null }));
}
let buf = '';
process.stdin.on('data', d => {
	buf += d.toString('utf8');
	for (;;) {
		const nl = buf.indexOf('\\n');
		if (nl < 0) {
			break;
		}
		const line = buf.slice(0, nl);
		buf = buf.slice(nl + 1);
		if (!line.trim()) {
			continue;
		}
		let msg;
		try { msg = JSON.parse(line); } catch { continue; }
		if (msg && msg.method === 'initialize' && msg.id !== undefined) {
			process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
		}
	}
});
process.stdin.on('end', () => process.exit(0));
`;

interface IFakeSdk {
	readonly root: string;
	readonly dumpPath: string;
	dispose(): Promise<void>;
}

async function makeFakeSdk(): Promise<IFakeSdk> {
	const root = await fs.promises.mkdtemp(join(os.tmpdir(), 'vscode-fake-codex-sdk-'));
	const suffix = codexPackageSuffix(process.platform, process.arch);
	const triple = suffix ? codexBinaryTriple(suffix) : undefined;
	assert.ok(suffix && triple, `tests need a known codex package for ${process.platform}-${process.arch}`);
	const binDir = join(root, 'node_modules', `@openai/codex-${suffix}`, 'vendor', triple, 'bin');
	await fs.promises.mkdir(binDir, { recursive: true });
	const binaryPath = join(binDir, process.platform === 'win32' ? 'codex.exe' : 'codex');
	await fs.promises.writeFile(binaryPath, FAKE_CODEX_SCRIPT, { mode: 0o755 });
	const dumpPath = join(root, 'dump.json');
	return {
		root,
		dumpPath,
		dispose: () => fs.promises.rm(root, { recursive: true, force: true }),
	};
}

async function readDump(dumpPath: string): Promise<{ args: string[]; openaiApiKey: string | null }> {
	return JSON.parse(await fs.promises.readFile(dumpPath, 'utf8'));
}

function listeningServerCount(): number {
	return (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles()
		.filter(h => h instanceof net.Server && h.listening)
		.length;
}

async function waitForServerCount(expected: number): Promise<number> {
	let count = listeningServerCount();
	for (let attempt = 0; attempt < 50 && count !== expected; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 20));
		count = listeningServerCount();
	}
	return count;
}

// #endregion

suite('CodexAgent proxy gating (Issue #39)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	async function withFakeConnection(githubToken: string | undefined, fn: (ready: IRawConnectionResult, proxy: CodexProxyService, dump: { args: string[]; openaiApiKey: string | null }) => Promise<void>, productService?: IProductService): Promise<void> {
		const sdk = await makeFakeSdk();
		const proxy = new CodexProxyService(undefined, new NullLogService(), new FakeCopilotApiService());
		const harness: IStartRawHarness = {
			_githubToken: githubToken,
			_codexProxyService: proxy,
			_logService: new NullLogService(),
			_otelService: { getNativeSdkTelemetryConfig: async () => undefined },
			_resolveSdkRoot: async () => sdk.root,
			...(productService !== undefined ? { _productService: productService } : {}),
		};
		const previousDump = process.env[DUMP_ENV_VAR];
		const previousOpenAiKey = process.env.OPENAI_API_KEY;
		process.env[DUMP_ENV_VAR] = sdk.dumpPath;
		delete process.env.OPENAI_API_KEY;
		let ready: IRawConnectionResult | undefined;
		try {
			ready = await startRawConnection.call(harness);
			const dump = await readDump(sdk.dumpPath);
			await fn(ready, proxy, dump);
		} finally {
			if (ready) {
				ready.client.dispose();
				try { ready.child.kill('SIGKILL'); } catch { /* already dead */ }
				ready.proxyHandle?.dispose();
			}
			proxy.dispose();
			if (previousDump === undefined) {
				delete process.env[DUMP_ENV_VAR];
			} else {
				process.env[DUMP_ENV_VAR] = previousDump;
			}
			if (previousOpenAiKey === undefined) {
				delete process.env.OPENAI_API_KEY;
			} else {
				process.env.OPENAI_API_KEY = previousOpenAiKey;
			}
			await sdk.dispose();
		}
	}

	test('without a GitHub token the proxy is never started and no port is bound', async function () {
		// Spawning the fake app-server can exceed the default 2s timeout under load.
		this.timeout(20000);
		// The fake binary is a node script executed via its shebang.
		if (process.platform === 'win32') {
			return;
		}
		const baseline = listeningServerCount();
		await withFakeConnection(undefined, async (ready, _proxy, dump) => {
			assert.strictEqual(ready.proxyHandle, undefined, 'no proxy handle without a token');
			assert.strictEqual(listeningServerCount(), baseline, 'no new listening socket after connection setup without a token');
			assert.ok(!dump.args.some(argument => argument.startsWith('model_providers.vscode-proxy')), 'launch config must not define the vscode-proxy provider');
			assert.strictEqual(dump.openaiApiKey, null, 'no OPENAI_API_KEY nonce without a proxy');
		});
		assert.strictEqual(await waitForServerCount(baseline), baseline, 'no listener remains after teardown');
	});

	test('with a GitHub token the proxy binds exactly one loopback listener', async function () {
		this.timeout(20000);
		if (process.platform === 'win32') {
			return;
		}
		const baseline = listeningServerCount();
		await withFakeConnection('gh-test-token', async (ready, _proxy, dump) => {
			const handle = ready.proxyHandle;
			assert.ok(handle, 'a proxy handle is returned with a token');
			assert.strictEqual(listeningServerCount(), baseline + 1, 'start() binds exactly one loopback listener');
			assert.strictEqual(new URL(handle.baseUrl).hostname, '127.0.0.1', 'the proxy binds loopback only');
			assert.ok(dump.args.includes(`model_providers.vscode-proxy.base_url="${handle.baseUrl}/v1"`), 'the vscode-proxy provider points at the live proxy');
			assert.strictEqual(dump.openaiApiKey, handle.nonce, 'OPENAI_API_KEY carries the proxy nonce');
		});
		assert.strictEqual(await waitForServerCount(baseline), baseline, 'disposing the handle closes the listener');
	});

	test('branded build (excludeCopilotFromPackaging): a token does not start the proxy (issue #66 M3)', async function () {
		this.timeout(20000);
		if (process.platform === 'win32') {
			return;
		}
		const brandedProduct = { excludeCopilotFromPackaging: true } as IProductService;
		const baseline = listeningServerCount();
		await withFakeConnection('gh-test-token', async (ready, _proxy, dump) => {
			assert.strictEqual(ready.proxyHandle, undefined, 'the CAPI proxy is never started in the branded build — its responses path would reject every call');
			assert.strictEqual(listeningServerCount(), baseline, 'no new listening socket');
			assert.ok(!dump.args.some(argument => argument.startsWith('model_providers.vscode-proxy')), 'launch config must not define the vscode-proxy provider');
		}, brandedProduct);
		assert.strictEqual(await waitForServerCount(baseline), baseline, 'no listener remains after teardown');
	});
});
