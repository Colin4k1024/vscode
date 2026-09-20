/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { uploadOne, selectBackend } from '../upload.ts';

/**
 * AC6 (Issue #11): `uploadOne` idempotency for the self-hosted `http`
 * backend (AGENT_SDK_UPLOAD_BACKEND=http), exercised against a loopback
 * HTTP server — no Azure, no network:
 *
 *   - object absent → PUT happens
 *   - same content re-upload → skipped, no second PUT
 *   - different content at the same path → fail loud, no overwrite
 *   - object present without sha metadata → fail loud, no overwrite
 *
 * The tarball filename drives (sdk, version, target) derivation in the CLI,
 * but `uploadOne` takes them as args, so a tiny fixture file stands in for
 * the real 50-100MB tarballs.
 */

const SAVED_BACKEND = process.env.AGENT_SDK_UPLOAD_BACKEND;
const SAVED_CDN_BASE = process.env.AGENT_SDK_CDN_BASE;
const SAVED_TEMPLATE = process.env.AGENT_SDK_URL_TEMPLATE;

interface IServerState {
	readonly puts: { url: string; sha256: string | null; bytes: number }[];
	readonly heads: string[];
	/** Objects the server "already has": url → sha256 */
	readonly objects: Map<string, string>;
}

async function withServer(fn: (baseUrl: string, state: IServerState) => Promise<void>): Promise<void> {
	const state: IServerState = { puts: [], heads: [], objects: new Map() };
	const server = http.createServer((req, res) => {
		const url = req.url ?? '';
		if (req.method === 'HEAD') {
			state.heads.push(url);
			const sha = state.objects.get(url);
			if (sha === undefined) {
				res.writeHead(404).end();
			} else if (sha === '') {
				res.writeHead(200).end(); // present, but no sha metadata
			} else {
				res.writeHead(200, { 'x-content-sha256': sha }).end();
			}
			return;
		}
		if (req.method === 'PUT') {
			const chunks: Buffer[] = [];
			req.on('data', c => chunks.push(c));
			req.on('end', () => {
				const body = Buffer.concat(chunks);
				state.puts.push({ url, sha256: req.headers['x-content-sha256'] as string ?? null, bytes: body.length });
				res.writeHead(201).end();
			});
			return;
		}
		res.writeHead(405).end();
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('no server address');
		}
		await fn(`http://127.0.0.1:${address.port}`, state);
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
}

function fixtureTarball(contents: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-http-test-'));
	const file = path.join(dir, 'fixture.tgz');
	fs.writeFileSync(file, contents);
	return file;
}

const ARGS = { sdk: 'codex', sdkVersion: '0.0.0-test', sdkTarget: 'darwin-arm64' } as const;

/** Object URL for the default path shape under the loopback base. */
function objectUrl(baseUrl: string): string {
	return `${baseUrl}${objectPath()}`;
}

/** Path (request-target) of the object — the key the server uses. */
function objectPath(): string {
	return `/agent-sdk/codex/0.0.0-test/darwin-arm64.tgz`;
}

suite('uploadOne http backend (AC6 idempotency)', () => {

	test('backend selection: unset → azure, http → http, garbage → fail loud', () => {
		delete process.env.AGENT_SDK_UPLOAD_BACKEND;
		assert.strictEqual(selectBackend(), 'azure');
		process.env.AGENT_SDK_UPLOAD_BACKEND = 'HTTP';
		assert.strictEqual(selectBackend(), 'http');
		process.env.AGENT_SDK_UPLOAD_BACKEND = 'ftp';
		assert.throws(() => selectBackend(), /must be 'azure' or 'http'/);
	});

	test('object absent → PUT with the sha256 header', async () => {
		await withServer(async (baseUrl, state) => {
			process.env.AGENT_SDK_UPLOAD_BACKEND = 'http';
			process.env.AGENT_SDK_CDN_BASE = baseUrl;
			const tgz = fixtureTarball('fresh bytes');
			const result = await uploadOne({ ...ARGS, tgzPath: tgz });
			assert.strictEqual(result.url, objectUrl(baseUrl));
			assert.strictEqual(state.puts.length, 1);
			assert.strictEqual(state.puts[0].sha256, result.sha256);
			assert.strictEqual(state.puts[0].bytes, fs.statSync(tgz).size);
			assert.deepStrictEqual(state.heads, [`/agent-sdk/codex/0.0.0-test/darwin-arm64.tgz`]);
		});
	});

	test('same content re-upload → skipped, no PUT', async () => {
		await withServer(async (baseUrl, state) => {
			process.env.AGENT_SDK_UPLOAD_BACKEND = 'http';
			process.env.AGENT_SDK_CDN_BASE = baseUrl;
			const tgz = fixtureTarball('same bytes');
			const first = await uploadOne({ ...ARGS, tgzPath: tgz });
			state.objects.set(objectPath(), first.sha256); // server now "has" it
			const second = await uploadOne({ ...ARGS, tgzPath: tgz });
			assert.strictEqual(second.url, first.url);
			assert.strictEqual(second.sha256, first.sha256);
			assert.strictEqual(state.puts.length, 1, 'second call must not PUT again');
		});
	});

	test('different content at the same path → fail loud, no overwrite', async () => {
		await withServer(async (baseUrl, state) => {
			process.env.AGENT_SDK_UPLOAD_BACKEND = 'http';
			process.env.AGENT_SDK_CDN_BASE = baseUrl;
			state.objects.set(objectPath(), 'deadbeef'.repeat(8));
			await assert.rejects(
				uploadOne({ ...ARGS, tgzPath: fixtureTarball('drifted bytes') }),
				/DIFFERENT x-content-sha256|refusing to overwrite/,
			);
			assert.strictEqual(state.puts.length, 0, 'must not overwrite content-addressed history');
		});
	});

	test('object present without sha metadata → fail loud, no overwrite', async () => {
		await withServer(async (baseUrl, state) => {
			process.env.AGENT_SDK_UPLOAD_BACKEND = 'http';
			process.env.AGENT_SDK_CDN_BASE = baseUrl;
			state.objects.set(objectPath(), ''); // present, no sha
			await assert.rejects(
				uploadOne({ ...ARGS, tgzPath: fixtureTarball('any bytes') }),
				/NO x-content-sha256 header|out-of-band/,
			);
			assert.strictEqual(state.puts.length, 0);
		});
	});

	test('upload URL follows AGENT_SDK_URL_TEMPLATE (GitHub Releases shape)', async () => {
		await withServer(async (baseUrl, state) => {
			process.env.AGENT_SDK_UPLOAD_BACKEND = 'http';
			process.env.AGENT_SDK_URL_TEMPLATE = `${baseUrl}/releases/download/agent-sdk-{sdk}-{sdkVersion}/{sdk}-{sdkVersion}-{sdkTarget}.tgz`;
			const result = await uploadOne({ ...ARGS, tgzPath: fixtureTarball('gh bytes') });
			assert.strictEqual(result.url, `${baseUrl}/releases/download/agent-sdk-codex-0.0.0-test/codex-0.0.0-test-darwin-arm64.tgz`);
			assert.strictEqual(state.puts.length, 1);
			assert.strictEqual(state.puts[0].url, `/releases/download/agent-sdk-codex-0.0.0-test/codex-0.0.0-test-darwin-arm64.tgz`);
		});
	});

	test.after(() => {
		for (const [name, saved] of [
			['AGENT_SDK_UPLOAD_BACKEND', SAVED_BACKEND],
			['AGENT_SDK_CDN_BASE', SAVED_CDN_BASE],
			['AGENT_SDK_URL_TEMPLATE', SAVED_TEMPLATE],
		] as const) {
			if (saved === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = saved;
			}
		}
	});
});
