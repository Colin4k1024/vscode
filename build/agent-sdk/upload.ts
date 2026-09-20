/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Uploads one agent-SDK tarball to the `main.vscode-cdn.net` storage account.
 * Callable as both a library function (`uploadOne(...)`) and a thin CLI.
 *
 * Two upload backends, selected by `AGENT_SDK_UPLOAD_BACKEND`:
 *
 *   - `azure` (default when the env var is unset): Azure Blob Storage behind
 *     the Microsoft CDN. Auth reads `AZURE_STORAGE_ACCOUNT`,
 *     `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_ID_TOKEN` from env — same
 *     shape as `build/azure-pipelines/upload-cdn.ts`.
 *
 *   - `http`: a generic self-hosted endpoint (object storage with plain
 *     HEAD/PUT, an artifact repository, …). The upload URL IS the download
 *     URL produced by `buildCdnUrl` (from `AGENT_SDK_CDN_BASE` /
 *     `AGENT_SDK_URL_TEMPLATE`), so what `uploadOne` reports is what the
 *     downloader will fetch. Auth is an optional static bearer token in
 *     `AGENT_SDK_UPLOAD_TOKEN`. The sha256 travels in the
 *     `x-content-sha256` header on PUT and is read back from the same
 *     header on HEAD.
 *
 *   (GitHub Releases does not speak plain HEAD/PUT per asset — use
 *   `scripts/publish-sdk-release.sh` for that endpoint, which applies the
 *   same HEAD-then-decide semantics via the release asset digest.)
 *
 * Idempotency: HEAD-first on the `.tgz` blob.
 *   - Absent → upload.
 *   - Present with matching sha256 (in `metadata.sha256` / the
 *     `x-content-sha256` header) → skip.
 *   - Present with different / no sha256 metadata → fail loud, refusing to
 *     overwrite content-addressed history. Recovery: delete the remote
 *     object and re-run.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildCdnUrl, getAgentMeta, parseFlags, type Sdk, sha256OfFile } from './common.ts';

const SCRIPT = 'upload.ts';

export interface IUploadArgs {
	readonly sdk: Sdk;
	readonly sdkVersion: string;
	readonly sdkTarget: string;
	readonly tgzPath: string;
	/** Pre-computed sha (e.g. from `buildOne()`); if omitted, computed here. */
	readonly sha256?: string;
}

export interface IUploadResult {
	readonly url: string;
	readonly sha256: string;
}

export async function uploadOne(args: IUploadArgs): Promise<IUploadResult> {
	if (!fs.existsSync(args.tgzPath)) {
		throw new Error(`[${SCRIPT}] Tarball does not exist: ${args.tgzPath}`);
	}
	const sha256 = args.sha256 ?? await sha256OfFile(args.tgzPath);

	switch (selectBackend()) {
		case 'azure':
			return uploadOneAzure(args, sha256);
		case 'http':
			return uploadOneHttp(args, sha256);
	}
}

/**
 * Which upload backend `uploadOne` drives. Unset/empty means `azure`
 * (upstream behavior); anything that is neither `azure` nor `http` fails
 * loud — a typo must not silently pick a backend.
 */
export function selectBackend(): 'azure' | 'http' {
	const raw = process.env.AGENT_SDK_UPLOAD_BACKEND?.trim().toLowerCase();
	if (raw === undefined || raw === '' || raw === 'azure') {
		return 'azure';
	}
	if (raw === 'http') {
		return 'http';
	}
	throw new Error(`[${SCRIPT}] AGENT_SDK_UPLOAD_BACKEND must be 'azure' or 'http' (got: ${JSON.stringify(raw)})`);
}

async function uploadOneAzure(args: IUploadArgs, sha256: string): Promise<IUploadResult> {
	// Lazy imports (L10): the Azure SDK is only needed on the Azure backend —
	// a static import would make the http backend (and its test suite)
	// unrunnable on a machine without the Azure packages installed.
	const [{ ClientAssertionCredential }, { BlobServiceClient }] = await Promise.all([
		import('@azure/identity'),
		import('@azure/storage-blob'),
	]);
	const account = requireEnv('AZURE_STORAGE_ACCOUNT');
	const tenantId = requireEnv('AZURE_TENANT_ID');
	const clientId = requireEnv('AZURE_CLIENT_ID');
	const idToken = requireEnv('AZURE_ID_TOKEN');

	const credential = new ClientAssertionCredential(tenantId, clientId, () => Promise.resolve(idToken));
	const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
	const container = service.getContainerClient('$web');
	const blobName = `agent-sdk/${args.sdk}/${args.sdkVersion}/${args.sdkTarget}.tgz`;
	const blob = container.getBlockBlobClient(blobName);

	console.log(`[${SCRIPT}] target: https://${account}.blob.core.windows.net/$web/${blobName}`);
	console.log(`[${SCRIPT}] local sha256: ${sha256}`);

	let existing;
	try {
		existing = await blob.getProperties();
	} catch (err) {
		const status = (err as { statusCode?: number }).statusCode;
		if (status !== 404) {
			throw err;
		}
		existing = undefined;
	}

	if (existing) {
		const remoteSha = existing.metadata?.sha256;
		if (remoteSha === sha256) {
			console.log(`[${SCRIPT}] blob already present with matching sha256 — skipping upload (idempotent).`);
			return { url: buildCdnUrl(args.sdk, args.sdkVersion, args.sdkTarget), sha256 };
		}
		throw new Error(
			`[${SCRIPT}] Blob already present with ${remoteSha ? 'DIFFERENT' : 'NO'} sha256 metadata — refusing to overwrite content-addressed history.\n` +
			`  remote: ${remoteSha ?? '<no metadata.sha256 — was this blob uploaded out-of-band?>'}\n` +
			`  local:  ${sha256}\n` +
			`If the local build is what should ship, delete the remote blob in Azure Portal and re-run. ` +
			`Otherwise: investigate why the same ${getAgentMeta(args.sdk).name}@${args.sdkVersion} produced different bytes.`,
		);
	}

	console.log(`[${SCRIPT}] uploading ${fs.statSync(args.tgzPath).size} bytes…`);
	await blob.uploadFile(args.tgzPath, {
		blobHTTPHeaders: {
			blobContentType: 'application/gzip',
			blobCacheControl: 'max-age=31536000, immutable',
		},
		metadata: { sha256 },
	});
	console.log(`[${SCRIPT}] ✓ uploaded.`);
	return { url: buildCdnUrl(args.sdk, args.sdkVersion, args.sdkTarget), sha256 };
}

/** Bound on any single HEAD/PUT so a hung endpoint fails the build instead
 *  of stalling the release job forever (tarballs are 50-100MB; 5 minutes is
 *  generous for the CDN-class endpoints this backend targets). */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Loopback hosts (a local test/dev server) are the only legitimate
 *  plaintext-http targets for a token-authenticated upload. */
function isLoopbackHostname(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
	if (h === 'localhost' || h === '::1') {
		return true;
	}
	// 127.0.0.0/8
	return /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * Generic HTTP backend: PUT the tarball to its own download URL, with the
 * sha256 in `x-content-sha256`. HEAD first for the idempotency decision.
 *
 * Kept dependency-free (global `fetch`) so it runs anywhere produce.ts runs
 * and so the idempotency semantics are testable against a loopback server
 * (`build/agent-sdk/test/uploadHttp.test.ts`).
 */
async function uploadOneHttp(args: IUploadArgs, sha256: string): Promise<IUploadResult> {
	const url = buildCdnUrl(args.sdk, args.sdkVersion, args.sdkTarget);
	const headers: Record<string, string> = {};
	const token = process.env.AGENT_SDK_UPLOAD_TOKEN?.trim();
	if (token) {
		// A bearer token over plaintext http to a routable host is a credential
		// leak (review round-1, MEDIUM-3a). Loopback stays allowed: the test
		// suite and local dry-runs against a dev server are legitimate.
		const { protocol, hostname } = new URL(url);
		if (protocol !== 'https:' && !isLoopbackHostname(hostname)) {
			throw new Error(
				`[${SCRIPT}] AGENT_SDK_UPLOAD_TOKEN is set but the upload URL is not https (${url}). ` +
				`Refusing to send a bearer token over plaintext to a non-loopback host. ` +
				`Use an https endpoint, or unset the token for an unauthenticated endpoint.`,
			);
		}
		headers.authorization = `Bearer ${token}`;
	}

	console.log(`[${SCRIPT}] target: ${url}`);
	console.log(`[${SCRIPT}] local sha256: ${sha256}`);

	const head = await fetch(url, { method: 'HEAD', headers, redirect: 'follow', signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
	if (head.status === 200) {
		const remoteSha = head.headers.get('x-content-sha256') ?? undefined;
		if (remoteSha === sha256) {
			console.log(`[${SCRIPT}] object already present with matching sha256 — skipping upload (idempotent).`);
			return { url, sha256 };
		}
		throw new Error(
			`[${SCRIPT}] Object already present at ${url} with ${remoteSha ? 'DIFFERENT' : 'NO'} x-content-sha256 header — refusing to overwrite content-addressed history.\n` +
			`  remote: ${remoteSha ?? '<no x-content-sha256 header — was this object uploaded out-of-band?>'}\n` +
			`  local:  ${sha256}\n` +
			`If the local build is what should ship, delete the remote object and re-run. ` +
			`Otherwise: investigate why the same ${getAgentMeta(args.sdk).name}@${args.sdkVersion} produced different bytes.`,
		);
	}
	if (head.status !== 404) {
		throw new Error(`[${SCRIPT}] HEAD ${url} returned ${head.status} — cannot make the upload decision safely, refusing to continue.`);
	}

	console.log(`[${SCRIPT}] uploading ${fs.statSync(args.tgzPath).size} bytes…`);
	// eslint-disable-next-line local/code-no-dangerous-type-assertions -- fs.ReadStream is a valid undici request body but is not typed as BodyInit.
	const put = await fetch(url, {
		method: 'PUT',
		headers: {
			...headers,
			'content-type': 'application/gzip',
			'cache-control': 'max-age=31536000, immutable',
			'x-content-sha256': sha256,
		},
		// Node's fetch requires `duplex: 'half'` for stream bodies.
		body: fs.createReadStream(args.tgzPath) as unknown as BodyInit,
		duplex: 'half',
		// Never auto-follow a PUT redirect (review round-1, MEDIUM-3b): the
		// follow would re-send the bearer token and a 50-100MB body to an
		// unvetted host, and undici would have to buffer or re-stream the
		// body. Treat any 3xx as a failure and surface the Location so the
		// endpoint URL can be fixed instead.
		redirect: 'manual',
		signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
	} as RequestInit);
	if (put.status >= 300 && put.status < 400) {
		throw new Error(
			`[${SCRIPT}] PUT ${url} was answered with a redirect (${put.status} → ${put.headers.get('location') ?? '<no Location header>'}). ` +
			`Redirects are not followed for uploads — fix AGENT_SDK_CDN_BASE / AGENT_SDK_URL_TEMPLATE to point at the final URL.`,
		);
	}
	if (!put.ok) {
		throw new Error(`[${SCRIPT}] PUT ${url} failed with ${put.status}: ${(await put.text()).slice(0, 500)}`);
	}
	console.log(`[${SCRIPT}] ✓ uploaded.`);
	return { url, sha256 };
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`[${SCRIPT}] Missing required environment variable: ${name}`);
	}
	return value;
}

// #region CLI entry point

function isCliInvocation(): boolean {
	// `import.meta.filename` is already a real filesystem path; comparing
	// it directly to `process.argv[1]` works on Windows (where the
	// manual `file://${argv}` construction breaks because Node URL-encodes
	// drive letters and spaces). Pattern matches `build/npm/installStateHash.ts:143`.
	return import.meta.filename === process.argv[1];
}

function parseCliArgs(): IUploadArgs {
	const flags = parseFlags(process.argv.slice(2));
	const tgzPath = flags.get('tarball');
	if (!tgzPath) { throw new Error('--tarball=<path> is required'); }
	// Filename convention from package.ts: `<sdk>-<sdkVersion>-<sdkTarget>.tgz`.
	const basename = path.basename(tgzPath);
	const match = /^(claude|codex)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-((?:darwin|linux|win32)-(?:x64|arm64)(?:-musl)?)\.tgz$/.exec(basename);
	if (!match) {
		throw new Error(`Cannot derive (sdk, version, target) from tarball filename '${basename}'`);
	}
	const [, sdk, sdkVersion, sdkTarget] = match;
	return { sdk: sdk as Sdk, sdkVersion, sdkTarget, tgzPath: path.resolve(tgzPath) };
}

if (isCliInvocation()) {
	uploadOne(parseCliArgs()).catch(err => {
		console.error(err);
		process.exit(1);
	});
}

// #endregion
