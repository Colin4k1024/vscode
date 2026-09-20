/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';

/**
 * Positive-control tests for scripts/check-no-copilot-artifacts.sh (issue #66
 * review): the D10 section 5 gate must CATCH block-listed packages, not just
 * pass clean trees — a gate that only ever passes silently is indistinguishable
 * from a broken one. The asar fixtures are packed from the node_modules
 * directory itself, matching how the desktop build roots node_modules.asar
 * (member paths carry no `node_modules/` prefix).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'scripts', 'check-no-copilot-artifacts.sh');
const ASAR_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'asar');

interface IGateResult {
	readonly code: number;
	readonly output: string;
}

function runGate(...dirs: string[]): IGateResult {
	try {
		const output = execFileSync('bash', [GATE, ...dirs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: process.env.PATH } });
		return { code: 0, output };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

function makeTree(): { dir: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-gate-'));
	return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function packAsar(nodeModulesContent: readonly string[], destAsar: string): void {
	// Pack a fake node_modules dir as the asar ROOT — the same rooting
	// createAsar uses for the shipped node_modules.asar.
	const nm = path.join(path.dirname(destAsar), 'staging-node_modules');
	for (const pkg of nodeModulesContent) {
		fs.mkdirSync(path.join(nm, pkg), { recursive: true });
		fs.writeFileSync(path.join(nm, pkg, 'package.json'), '{}');
	}
	execFileSync(ASAR_BIN, ['pack', nm, destAsar]);
	fs.rmSync(nm, { recursive: true, force: true });
}

suite('check-no-copilot-artifacts (positive control, issue #66)', () => {

	test('catches a block-listed package that exists ONLY inside node_modules.asar (real layout: no node_modules/ prefix)', () => {
		const { dir, cleanup } = makeTree();
		try {
			packAsar(['@vscode/copilot-api', '@github/copilot-sdk'], path.join(dir, 'node_modules.asar'));
			const r = runGate(dir);
			assert.strictEqual(r.code, 1, `gate must fail — output: ${r.output}`);
			assert.ok(r.output.includes('@vscode/copilot-api'), `names the blocked package: ${r.output}`);
			assert.ok(!r.output.includes('@github/copilot-sdk —'), `allowlisted package not reported: ${r.output}`);
		} finally {
			cleanup();
		}
	});

	test('catches a block-listed package that exists only under node_modules.asar.unpacked/', () => {
		const { dir, cleanup } = makeTree();
		try {
			const unpacked = path.join(dir, 'node_modules.asar.unpacked', '@github', 'copilot');
			fs.mkdirSync(unpacked, { recursive: true });
			fs.writeFileSync(path.join(unpacked, 'native.node'), 'x');
			const r = runGate(dir);
			assert.strictEqual(r.code, 1, `gate must fail — output: ${r.output}`);
			assert.ok(r.output.includes('node_modules.asar.unpacked'), `names the unpacked tree: ${r.output}`);
		} finally {
			cleanup();
		}
	});

	test('passes a tree whose asar carries only allowlisted packages', () => {
		const { dir, cleanup } = makeTree();
		try {
			packAsar(['@github/copilot-sdk', '@github/copilot-sdk-darwin-arm64'], path.join(dir, 'node_modules.asar'));
			const r = runGate(dir);
			assert.strictEqual(r.code, 0, `gate must pass — output: ${r.output}`);
		} finally {
			cleanup();
		}
	});

	test('fails closed when the mixin declares no copilotPackagingBlocklist', () => {
		// The gate reads the block list from the repo mixin; this test pins the
		// fail-closed contract by running against a mixin copy with the key
		// deleted. The gate resolves the mixin relative to its own location,
		// so this runs against a scratch repo copy of the two files involved.
		const { dir, cleanup } = makeTree();
		try {
			const fakeRepo = path.join(dir, 'repo');
			fs.mkdirSync(path.join(fakeRepo, 'scripts'), { recursive: true });
			fs.mkdirSync(path.join(fakeRepo, 'product'), { recursive: true });
			fs.copyFileSync(GATE, path.join(fakeRepo, 'scripts', 'check-no-copilot-artifacts.sh'));
			const mixin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'product', 'product.json'), 'utf8')) as Record<string, unknown>;
			delete mixin['copilotPackagingBlocklist'];
			fs.writeFileSync(path.join(fakeRepo, 'product', 'product.json'), JSON.stringify(mixin, null, '\t'));
			const appDir = path.join(dir, 'app');
			fs.mkdirSync(appDir, { recursive: true });
			const r = runGateWithScript(path.join(fakeRepo, 'scripts', 'check-no-copilot-artifacts.sh'), appDir);
			assert.strictEqual(r.code, 1, `gate must fail closed — output: ${r.output}`);
			assert.ok(r.output.includes('copilotPackagingBlocklist'), `names the missing key: ${r.output}`);
		} finally {
			cleanup();
		}
	});
});

function runGateWithScript(script: string, ...dirs: string[]): IGateResult {
	try {
		const output = execFileSync('bash', [script, ...dirs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: process.env.PATH } });
		return { code: 0, output };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}
