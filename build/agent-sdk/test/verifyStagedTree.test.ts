/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { chmodPlatformBinaries, listPlatformBinaries, verifyStagedTree } from '../package.ts';

/**
 * AC7 (Issue #11): `verifyStagedTree` assertions for the codex tarball.
 *
 * The codex npm package ships only a `bin` (no `main`), so the import probe
 * is skipped; the hard guarantees come from `listPlatformBinaries` hitting
 * `vendor/<rust-triple>/bin/` under `node_modules/@openai/codex-<target>` and
 * every binary being present + non-empty + executable.
 *
 * These tests stage a synthetic `node_modules/@openai/codex-darwin-arm64`
 * tree — no npm ci, no network, no 100MB tarball.
 */

const SDK = 'codex';
const TARGET = 'darwin-arm64';
const VERSION = '0.153.0';

interface IStage {
	readonly stagingDir: string;
	readonly nodeModulesDir: string;
	readonly binDir: string;
	cleanup(): void;
}

/** Build the minimal tree verifyStagedTree inspects. */
function stageCodexTree(binaries: { name: string; contents: string; mode: number }[]): IStage {
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-tree-test-'));
	const binDir = path.join(stagingDir, 'node_modules', '@openai', 'codex-darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'bin');
	fs.mkdirSync(binDir, { recursive: true });
	// codex ships no `main`; provide the manifest the entry resolver reads.
	fs.writeFileSync(
		path.join(stagingDir, 'node_modules', '@openai', 'codex-darwin-arm64', 'package.json'),
		JSON.stringify({ name: '@openai/codex-darwin-arm64', version: VERSION }) + '\n',
	);
	for (const b of binaries) {
		const p = path.join(binDir, b.name);
		fs.writeFileSync(p, b.contents);
		fs.chmodSync(p, b.mode);
	}
	return {
		stagingDir,
		nodeModulesDir: path.join(stagingDir, 'node_modules'),
		binDir,
		cleanup: () => fs.rmSync(stagingDir, { recursive: true, force: true }),
	};
}

suite('verifyStagedTree for the codex tarball (AC7)', () => {

	test('listPlatformBinaries hits vendor/<triple>/bin/ under @openai/codex-<target>', () => {
		const stage = stageCodexTree([{ name: 'codex', contents: '#!/bin/sh\n', mode: 0o644 }]);
		try {
			const binaries = listPlatformBinaries(stage.nodeModulesDir, SDK, TARGET);
			assert.deepStrictEqual(binaries, [path.join(stage.binDir, 'codex')]);
		} finally {
			stage.cleanup();
		}
	});

	test('passes on present + non-empty + executable binaries (after chmodPlatformBinaries)', () => {
		// 0o644 on purpose: chmodPlatformBinaries must set the exec bit, and
		// verifyStagedTree must observe it — both read from listPlatformBinaries,
		// so the two cannot drift (AC7).
		const stage = stageCodexTree([{ name: 'codex', contents: '#!/bin/sh\necho codex\n', mode: 0o644 }]);
		try {
			chmodPlatformBinaries(stage.nodeModulesDir, SDK, TARGET);
			verifyStagedTree(SDK, stage.stagingDir, TARGET, VERSION);
		} finally {
			stage.cleanup();
		}
	});

	test('fails when the native binary is missing', () => {
		const stage = stageCodexTree([]);
		try {
			assert.throws(
				() => verifyStagedTree(SDK, stage.stagingDir, TARGET, VERSION),
				/found no native binaries in the staged tree/,
			);
		} finally {
			stage.cleanup();
		}
	});

	test('fails when the native binary is empty', () => {
		const stage = stageCodexTree([{ name: 'codex', contents: '', mode: 0o755 }]);
		try {
			assert.throws(
				() => verifyStagedTree(SDK, stage.stagingDir, TARGET, VERSION),
				/is empty/,
			);
		} finally {
			stage.cleanup();
		}
	});

	test('fails when the native binary is not executable', () => {
		if (process.platform === 'win32') {
			// The mode check is a no-op on Windows hosts by design.
			return;
		}
		const stage = stageCodexTree([{ name: 'codex', contents: '#!/bin/sh\n', mode: 0o644 }]);
		try {
			assert.throws(
				() => verifyStagedTree(SDK, stage.stagingDir, TARGET, VERSION),
				/is not executable/,
			);
		} finally {
			stage.cleanup();
		}
	});

	test('codex has no package main → the import probe is skipped, binary checks still run', () => {
		// If verifyStagedTree tried to import-probe a codex tree it would find
		// no entry and skip; a broken binary must still fail the build.
		const stage = stageCodexTree([{ name: 'codex', contents: '', mode: 0o755 }]);
		try {
			assert.throws(() => verifyStagedTree(SDK, stage.stagingDir, TARGET, VERSION), /is empty/);
		} finally {
			stage.cleanup();
		}
	});
});
