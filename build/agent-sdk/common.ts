/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared helpers for the per-platform agent SDK build pipeline. Called
 * from `package.ts`, `upload.ts`, and `produce.ts`, plus the gulpfiles'
 * `packageTask` (via `readAgentSdkResults`) so each VS Code build can
 * stamp its own `product.agentSdks.<sdk>` into the per-platform
 * `product.json` at packaging time.
 *
 * Source of truth for the SDK list and version pins:
 *   `build/agent-sdk/agents/<sdk>/{package.json,package-lock.json}`.
 * Each subdirectory under `agents/` is one SDK. The folder name is the
 * SDK id (the key under `product.agentSdks`); the `package.json` names
 * exactly one npm dependency (the SDK's own package) and its exact
 * version; the `package-lock.json` pins the full transitive graph for
 * byte-deterministic `npm ci`. Add an SDK by adding a folder, run
 * `npm install` inside it once to generate the lockfile, commit both.
 *
 * `getSdkTargetForBuild()` hard-codes the
 * `(vscodePlatform, arch, sdk) → sdkTarget` table; the SDK's own npm
 * `optionalDependencies` are the canonical SKU set, and the table is
 * kept in lockstep with it by convention.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Root of the per-SDK `{package.json, package-lock.json}` directories. */
export const AGENTS_DIR = path.join(THIS_DIR, 'agents');

/**
 * SDK identifier — the folder name under `agents/`, also the key under
 * `product.agentSdks` and the path segment in the CDN URL. Open string
 * type rather than a closed union so adding a new SDK is one folder, no
 * compile-time list change required.
 */
export type Sdk = string;

let _sdksCache: readonly Sdk[] | undefined;

/**
 * All SDKs the pipeline knows about, in stable sort order. Discovered
 * at load time by listing `agents/`. Cached because the set never
 * changes mid-process.
 */
export function getSdks(): readonly Sdk[] {
	if (_sdksCache) {
		return _sdksCache;
	}
	const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
	_sdksCache = entries
		.filter(e => e.isDirectory())
		.map(e => e.name)
		.sort();
	return _sdksCache;
}

/** Path to a given SDK's agents/ subdirectory (the one with package.json). */
export function getAgentDir(sdk: Sdk): string {
	const dir = path.join(AGENTS_DIR, sdk);
	if (!fs.existsSync(dir)) {
		throw new Error(`Unknown SDK '${sdk}': no directory at ${dir}. Add a folder under build/agent-sdk/agents/ with a package.json + package-lock.json.`);
	}
	return dir;
}

interface IAgentPackageJson {
	readonly dependencies?: Readonly<Record<string, string>>;
}

let _agentMetaCache: Map<Sdk, { name: string; version: string }> | undefined;

/**
 * Returns the npm package name and pinned version this SDK ships. Read
 * from `agents/<sdk>/package.json`'s single dependency.
 *
 * The agent's `package.json` MUST declare exactly one dependency (the SDK's
 * own npm package) at an exact version — no `^` / `~` ranges. Ranges
 * would let `npm install` resolve different versions across runs, which
 * the CDN's HEAD-then-fail upload rejects.
 */
export function getAgentMeta(sdk: Sdk): { name: string; version: string } {
	if (!_agentMetaCache) {
		_agentMetaCache = new Map();
	}
	const cached = _agentMetaCache.get(sdk);
	if (cached) {
		return cached;
	}
	const pkgPath = path.join(getAgentDir(sdk), 'package.json');
	const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as IAgentPackageJson;
	const deps = json.dependencies ?? {};
	const entries = Object.entries(deps);
	if (entries.length !== 1) {
		throw new Error(`Expected exactly one dependency in ${pkgPath}, found ${entries.length}: ${entries.map(([k]) => k).join(', ')}`);
	}
	const [name, version] = entries[0];
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Refusing to use ${name}@${version} from ${pkgPath}: must be an exact version (no ^ or ~ ranges)`);
	}
	const meta = { name, version };
	_agentMetaCache.set(sdk, meta);
	return meta;
}

/** Convenience shortcut for `getAgentMeta(sdk).version`. */
export function getSdkVersion(sdk: Sdk): string {
	return getAgentMeta(sdk).version;
}

/** Strict subset of VS Code build platforms — the SDK pipeline only knows
 *  about platforms it can target. `web` is excluded (no SDK on web). */
export type VscodeBuildPlatform = 'darwin' | 'linux' | 'alpine' | 'win32';

/** Runtime whitelist mirroring `VscodeBuildPlatform`. Used by CLI guards so
 *  a typo like `--vscode-platform=lnux` fails loud instead of silently
 *  emitting an empty results file. */
export const KNOWN_VSCODE_PLATFORMS: ReadonlySet<VscodeBuildPlatform> = new Set([
	'darwin', 'linux', 'alpine', 'win32',
]);

/** Strict subset of architectures. `armhf` is excluded — no SDK ships armhf. */
export type VscodeBuildArch = 'x64' | 'arm64';

/**
 * Resolves the SDK's npm `optionalDependencies` suffix for a particular VS
 * Code build. Returns undefined when the VS Code build's `(platform, arch)`
 * has no compatible SDK (e.g. armhf, web, any combination we don't ship).
 *
 * - Claude ships `linux-{x64,arm64}-musl` packages separately from the glibc
 *   variants. Alpine REH builds get the `-musl` variant; regular Linux gets
 *   the plain `linux-*`.
 * - Codex's Linux binaries are statically musl-linked and ship under a
 *   single `linux-*` SKU that runs on both glibc and musl hosts. Alpine
 *   REH gets the same `linux-*` package as regular Linux.
 *
 * REH uses two encodings for Alpine x64: the modern `{platform: 'alpine',
 * arch: 'x64'}` and the legacy `{platform: 'linux', arch: 'alpine'}`. Both
 * are accepted.
 */
export function getSdkTargetForBuild(
	vscodePlatform: string,
	arch: string,
	sdk: Sdk,
): string | undefined {
	// Normalize the legacy Alpine x64 encoding into the modern one.
	if (vscodePlatform === 'linux' && arch === 'alpine') {
		vscodePlatform = 'alpine';
		arch = 'x64';
	}
	if (arch !== 'x64' && arch !== 'arm64') {
		return undefined;
	}
	switch (vscodePlatform) {
		case 'darwin': return `darwin-${arch}`;
		case 'win32': return `win32-${arch}`;
		case 'linux': return `linux-${arch}`;
		case 'alpine':
			return sdk === 'claude' ? `linux-${arch}-musl` : `linux-${arch}`;
		default:
			return undefined;
	}
}

/**
 * Base URL of the CDN the SDK tarballs are served from. Defaults to
 * Microsoft's CDN (upstream behavior). A fork running its own distribution
 * sets `AGENT_SDK_CDN_BASE` (e.g. `https://cdn.example.net`) so the URLs
 * stamped into `product.agentSdks.<sdk>.urlTemplate` — and the URLs
 * `uploadOne` reports — point at the fork's own storage. The path shape
 * `agent-sdk/<sdk>/<version>/<target>.tgz` is identical on both, so the
 * runtime downloader and the HEAD-then-decide upload semantics are
 * unchanged.
 *
 * A set-but-unusable value throws rather than silently falling back: the
 * fallback direction is exactly the domain a fork's egress allowlist is
 * most likely to forbid, and a typo'd env var must not quietly stamp the
 * Microsoft CDN into a fork's product.json (same fail-loud rule as the
 * exact-version pin in `getAgentMeta`).
 */
export function cdnBase(): string {
	const raw = process.env.AGENT_SDK_CDN_BASE?.trim();
	if (raw === undefined || raw === '') {
		return 'https://main.vscode-cdn.net';
	}
	const base = raw.replace(/\/+$/, '');
	if (!/^https?:\/\//i.test(base)) {
		throw new Error(
			`AGENT_SDK_CDN_BASE must be an http(s) URL (got: ${JSON.stringify(raw)}). ` +
			`Unset it to use the default https://main.vscode-cdn.net.`,
		);
	}
	return base;
}

/**
 * Full URL-template override for self-hosted distribution endpoints whose
 * URL shape is NOT `<base>/agent-sdk/<sdk>/<version>/<target>.tgz` — most
 * notably GitHub Releases, where assets are flat file names under a tag
 * (no directory segments):
 *
 *   AGENT_SDK_URL_TEMPLATE=https://github.com/<owner>/<repo>/releases/download/agent-sdk-{sdk}-{sdkVersion}/{sdk}-{sdkVersion}-{sdkTarget}.tgz
 *
 * `{sdk}` and `{sdkVersion}` are substituted here (build time);
 * `{sdkTarget}` is left intact for the runtime downloader to substitute per
 * launch. The override MUST contain a literal `{sdkTarget}` — without it
 * every platform would download the same file, which is exactly the macOS
 * Universal hazard the template mechanism exists to prevent.
 *
 * Set-but-unusable values throw (same fail-loud rule as the
 * `AGENT_SDK_CDN_BASE` validation in `cdnBase()`): a typo must not quietly
 * stamp a broken template into product.json.
 *
 * Returns undefined when the override is unset/empty.
 */
function urlTemplateOverride(): string | undefined {
	const raw = process.env.AGENT_SDK_URL_TEMPLATE?.trim();
	if (raw === undefined || raw === '') {
		return undefined;
	}
	if (!/^https?:\/\//i.test(raw)) {
		throw new Error(
			`AGENT_SDK_URL_TEMPLATE must be an http(s) URL (got: ${JSON.stringify(raw)}). ` +
			`Unset it to use the default <base>/agent-sdk/<sdk>/<version>/<target>.tgz shape.`,
		);
	}
	if (!raw.includes('{sdkTarget}')) {
		throw new Error(
			`AGENT_SDK_URL_TEMPLATE must contain a literal {sdkTarget} placeholder (got: ${JSON.stringify(raw)}). ` +
			`Without it every platform would resolve to the same download.`,
		);
	}
	return raw;
}

/**
 * Builds the CDN URL the per-platform `product.agentSdks.<sdk>.url` points at.
 * Content-addressed under `agent-sdk/<sdk>/<version>/<target>.tgz` by default
 * (matching the upload path written by `upload.ts`); honors the
 * `AGENT_SDK_URL_TEMPLATE` override when set.
 */
export function buildCdnUrl(sdk: Sdk, sdkVersion: string, sdkTarget: string): string {
	return buildCdnUrlTemplate(sdk, sdkVersion).replaceAll('{sdkTarget}', sdkTarget);
}

/**
 * Builds the `format2`-style URL template stamped into
 * `product.agentSdks.<sdk>.urlTemplate`. The runtime substitutes
 * `{sdkTarget}` per launch via `resolveSdkTarget` in
 * `src/vs/platform/agentHost/node/agentSdkDownloader.ts`. Matches the
 * upload path written by `upload.ts` with `{sdkTarget}` in place of the
 * concrete target suffix. `AGENT_SDK_URL_TEMPLATE` overrides the whole
 * shape (see `urlTemplateOverride`).
 */
export function buildCdnUrlTemplate(sdk: Sdk, sdkVersion: string): string {
	const override = urlTemplateOverride();
	if (override !== undefined) {
		return override
			.replaceAll('{sdk}', sdk)
			.replaceAll('{sdkVersion}', sdkVersion);
	}
	return `${cdnBase()}/agent-sdk/${sdk}/${sdkVersion}/{sdkTarget}.tgz`;
}

/** Streams `filePath` into a sha256 hasher. Avoids reading the whole file
 *  into memory — agent SDK tarballs are 50-100MB. */
export function sha256OfFile(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

/** Parses `--key=value` CLI flags into a Map. Shared by the script-mode
 *  entry points in `package.ts`, `upload.ts`, and `produce.ts`. */
export function parseFlags(argv: readonly string[]): Map<string, string> {
	const flags = new Map<string, string>();
	for (const arg of argv) {
		const m = /^--([a-zA-Z-]+)=(.+)$/.exec(arg);
		if (m) {
			flags.set(m[1], m[2]);
		}
	}
	return flags;
}

/**
 * Per-SDK product.json entry, written by `produce.ts` and read by the
 * gulpfiles' `packageTask`. Shape matches `IAgentSdkProductConfig` in
 * `src/vs/base/common/product.ts` so the values can be dropped straight
 * into `product.agentSdks`.
 *
 * Every platform job emits the SAME `{version, urlTemplate}` per SDK — the
 * `{sdkTarget}` placeholder is resolved at runtime per launch (see
 * `resolveSdkTarget` in `agentSdkDownloader.ts`). This is what lets a
 * macOS Universal bundle share one `product.json` across arm64+x64.
 *
 * `sha256ByTarget` keys the tarball hash by the `{sdkTarget}` it was built
 * for: per-target tarballs carry per-target native binaries, so their
 * bytes differ per target and a single scalar hash would fail closed for
 * every target but the one that stamped it (the macOS Universal hazard).
 * `produce.ts` merges successive per-target invocations into one map (see
 * {@link mergeAgentSdkResults}), so a pipeline that builds several targets
 * accumulates one entry per target. The runtime downloader verifies the
 * downloaded bytes against `sha256ByTarget[resolvedSdkTarget]` before
 * extracting (HIGH-1 integrity chain: build computes → results.json →
 * product.json → runtime verifies).
 *
 * `sha256` (scalar) is the legacy shape from before per-target keying; it
 * is read back for backward compatibility only — new writes must use
 * `sha256ByTarget`.
 */
export interface IAgentSdkResults {
	[packageId: string]: {
		readonly version: string;
		readonly urlTemplate: string;
		readonly sha256ByTarget?: { readonly [sdkTarget: string]: string };
		/** Legacy pre-per-target hash. Read-only backward compatibility; never written by current tooling. */
		readonly sha256?: string;
	};
}

/**
 * Merges the SDK entries a produce run just built (`produced`) into the
 * contents of a pre-existing results file (`existing`), accumulating
 * per-target hashes: the run that builds `darwin-arm64` and the run that
 * builds `darwin-x64` each contribute their own `sha256ByTarget` entry, so
 * the file a Universal product.json is stamped from covers both.
 *
 * Fail-loud on cross-run drift: a results file that names the same SDK at
 * two different versions (or two different urlTemplates) is incoherent as
 * one product.json — the caller must start from a clean file instead of
 * silently mixing (bundle-codex-sdk.sh deletes a version-drifted file
 * before producing).
 *
 * A legacy scalar `sha256` in `existing` is dropped on merge: it is valid
 * for at most one target and would poison the others; the per-target map
 * replaces it.
 *
 * Note the merged entry is REBUILT from the known fields — any field a
 * future schema revision adds is preserved for SDKs this run did not touch
 * (carried via the outer `{ ...existing }`) but DROPPED for a merged SDK.
 * That is deliberate: a field added to the producer must be threaded through
 * this function explicitly so it is never silently lost mid-sequence.
 */
export function mergeAgentSdkResults(existing: IAgentSdkResults, produced: IAgentSdkResults): IAgentSdkResults {
	const merged: IAgentSdkResults = { ...existing };
	for (const [sdk, entry] of Object.entries(produced)) {
		const prior = merged[sdk];
		if (!prior) {
			merged[sdk] = entry;
			continue;
		}
		if (prior.version !== entry.version) {
			throw new Error(`results file has ${sdk}@${prior.version} but this run produced ${entry.version} — refusing to mix versions in one results file. Delete the stale results file and re-run.`);
		}
		if (prior.urlTemplate !== entry.urlTemplate) {
			throw new Error(`results file has ${sdk} urlTemplate '${prior.urlTemplate}' but this run produced '${entry.urlTemplate}' — refusing to mix distribution endpoints in one results file. Delete the stale results file and re-run.`);
		}
		merged[sdk] = {
			version: entry.version,
			urlTemplate: entry.urlTemplate,
			sha256ByTarget: { ...prior.sha256ByTarget, ...entry.sha256ByTarget },
		};
	}
	return merged;
}

/**
 * Reads the per-platform agent-SDK results file written by `produce.ts`.
 * Returns `{}` when `AGENT_SDK_RESULTS_FILE` is unset or the file doesn't
 * exist — that's the local-dev path (no agent SDKs produced, ship
 * product.json without `agentSdks`, providers don't register).
 */
export function readAgentSdkResults(): IAgentSdkResults {
	const filePath = process.env.AGENT_SDK_RESULTS_FILE;
	if (!filePath || !fs.existsSync(filePath)) {
		return {};
	}
	return readAgentSdkResultsFile(filePath);
}

/**
 * Reads and minimally validates a results file at an explicit path (the
 * env-var-independent half of {@link readAgentSdkResults}, exported so
 * `produce.ts` can merge into a file it is about to rewrite).
 */
export function readAgentSdkResultsFile(filePath: string): IAgentSdkResults {
	const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`agent SDK results file at ${filePath} is not a JSON object`);
	}
	return parsed as IAgentSdkResults;
}
