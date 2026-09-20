/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TelemetryConfiguration } from '../../../telemetry/common/telemetry.js';
import {
	composeAgentHostBootstrapScript,
	decodeWslOutput,
	parseRunningDistros,
	parseWslListVerbose,
} from '../../node/wslRemoteAgentHostHelpers.js';
suite('WSL Remote Agent Host Helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	suite('parseWslListVerbose', () => {
		// Build a verbose-list output from a structured row description so
		// the test cases stay readable. The whitespace shape mirrors what
		// `wsl.exe --list --verbose` emits in practice (default marker is
		// `* ` at column 0; the data columns are space-padded).
		function row(opts: { name: string; state: string; version: number; isDefault?: boolean }): string {
			const marker = opts.isDefault ? '* ' : '  ';
			return `${marker}${opts.name.padEnd(24, ' ')}${opts.state.padEnd(16, ' ')}${opts.version}`;
		}
		test('parses a representative listing end-to-end', () => {
			const output = [
				'\uFEFF  NAME                    STATE           VERSION',
				row({ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }),
				row({ name: 'Debian', state: 'Stopped', version: 2 }),
				row({ name: 'Ubuntu 22.04', state: 'Running', version: 2 }),
				row({ name: 'Legacy', state: 'Stopped', version: 1 }),
				'',
				'',
			].join('\r\n');
			assert.deepStrictEqual(parseWslListVerbose(output), [
				{ name: 'Ubuntu', isDefault: true, isRunning: true, version: 2 },
				{ name: 'Debian', isDefault: false, isRunning: false, version: 2 },
				{ name: 'Ubuntu 22.04', isDefault: false, isRunning: true, version: 2 },
			]);
		});
		test('tolerates LF-only line endings and missing BOM', () => {
			const output = [
				'  NAME                    STATE           VERSION',
				row({ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }),
			].join('\n');
			assert.deepStrictEqual(parseWslListVerbose(output), [
				{ name: 'Ubuntu', isDefault: true, isRunning: true, version: 2 },
			]);
		});
		test('returns empty for empty input', () => {
			assert.deepStrictEqual(parseWslListVerbose(''), []);
		});
	});
	suite('parseRunningDistros', () => {
		test('parses a representative running list end-to-end', () => {
			assert.deepStrictEqual(
				parseRunningDistros('\uFEFFUbuntu\r\nUbuntu 22.04\r\nDebian\r\n\r\n'),
				['Ubuntu', 'Ubuntu 22.04', 'Debian'],
			);
		});
		test('returns empty for empty input', () => {
			assert.deepStrictEqual(parseRunningDistros(''), []);
		});
	});
	suite('decodeWslOutput', () => {
		test('decodes UTF-8 input', () => {
			assert.strictEqual(decodeWslOutput(Buffer.from('Hello, WSL!\n', 'utf8')), 'Hello, WSL!\n');
		});
		test('strips UTF-8 BOM', () => {
			assert.strictEqual(
				decodeWslOutput(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Ubuntu', 'utf8')])),
				'Ubuntu',
			);
		});
		test('decodes UTF-16LE input with BOM', () => {
			const text = 'There is no distribution with the supplied name.';
			const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
			assert.strictEqual(decodeWslOutput(buffer), text);
		});
		test('detects null-padded UTF-16LE without BOM via heuristic', () => {
			const text = 'WSL is not running';
			assert.strictEqual(decodeWslOutput(Buffer.from(text, 'utf16le')), text);
		});
		test('returns empty string for empty buffer', () => {
			assert.strictEqual(decodeWslOutput(Buffer.alloc(0)), '');
		});
	});
	suite('composeAgentHostBootstrapScript', () => {
		test('propagates telemetry disablement to the WSL agent host', () => {
			const commit = 'a'.repeat(40);
			const script = composeAgentHostBootstrapScript({
				serverDataFolderName: '.vscode-server',
				quality: 'stable',
				commit,
				os: 'linux',
				arch: 'x64',
				telemetryLevel: TelemetryConfiguration.OFF,
			});
			assert.ok(script.endsWith(`exec "$cli" --cli-data-dir ~/.vscode-server/cli --telemetry-level off agent host --port 0 --idle-timeout 300`));
		});
		test('pinned install recovers from a failed download via a pre-existing CLI', () => {
			const commit = 'a'.repeat(40);
			const script = composeAgentHostBootstrapScript({
				serverDataFolderName: '.vscode-server',
				quality: 'stable',
				commit,
				os: 'linux',
				arch: 'x64',
			});
			assert.ok(script.includes(`cli=~/.vscode-server/code-${commit}`), 'resolves the commit-keyed CLI into $cli');
			assert.ok(script.includes('fallback=$('), 'runs the fallback finder when the download fails');
			assert.ok(script.includes('cli="$fallback"'), 're-points $cli at the fallback');
			assert.ok(script.includes('no fallback CLI exists on this machine'), 'fails loud when nothing usable exists');
		});
		test('loose install recovers from a failed download via a pre-existing CLI', () => {
			const script = composeAgentHostBootstrapScript({
				serverDataFolderName: '.vscode-server',
				quality: 'stable',
				commit: undefined,
				os: 'linux',
				arch: 'x64',
			});
			assert.ok(script.includes('cli=~/.vscode-server/code &&') || script.includes('cli=~/.vscode-server/code\n') || /cli=~\/\.vscode-server\/code\s/.test(script), 'resolves the loose CLI into $cli');
			assert.ok(script.includes('fallback=$('), 'runs the fallback finder when the download fails');
			assert.ok(script.includes('cli="$fallback"'), 're-points $cli at the fallback');
			assert.ok(script.includes('no fallback CLI exists on this machine'), 'fails loud when nothing usable exists');
		});
		// The composed script is the actual artifact WSL executes — pin its
		// *behavior*, not its text: run it under bash with a stubbed `curl`
		// (exit 22, as on a 404) and a controlled $HOME.
		suite('composed script execution (POSIX only)', () => {
			const commit = 'a'.repeat(40);
			function runScript(script: string, home: string, stubBin: string): { code: number; stderr: string } {
				const result = cp.spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
					encoding: 'utf8',
					timeout: 30_000,
					env: { HOME: home, PATH: `${stubBin}:${process.env.PATH}` },
				});
				return { code: result.status ?? -1, stderr: String(result.stderr ?? '') };
			}
			function makeFixture(): { home: string; stubBin: string; cleanup(): void } {
				const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-bootstrap-home-'));
				const stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-bootstrap-bin-'));
				// curl always fails, as it does against the unpublished release endpoint.
				fs.writeFileSync(path.join(stubBin, 'curl'), '#!/bin/sh\nexit 22\n', { mode: 0o755 });
				return {
					home, stubBin,
					cleanup: () => {
						fs.rmSync(home, { recursive: true, force: true });
						fs.rmSync(stubBin, { recursive: true, force: true });
					},
				};
			}
			function seedFakeCli(binPath: string): void {
				fs.mkdirSync(path.dirname(binPath), { recursive: true });
				// Every invocation (the --version validation and the final exec)
				// appends a marker, so the test can prove which binary ran.
				fs.writeFileSync(binPath, '#!/bin/sh\necho ran >> "$HOME/.cli-ran"\n', { mode: 0o755 });
			}
			function cliRunCount(home: string): number {
				try {
					return fs.readFileSync(path.join(home, '.cli-ran'), 'utf8').trim().split('\n').length;
				} catch {
					return 0;
				}
			}
			test('recovers via the legacy pre-installed CLI when the download fails', function () {
				if (process.platform === 'win32') {
					return this.skip();
				}
				const { home, stubBin, cleanup } = makeFixture();
				try {
					seedFakeCli(`${home}/.vscode-cli-insider/code-insiders`);
					const script = composeAgentHostBootstrapScript({ serverDataFolderName: '.vscode-server-oss', quality: 'insider', commit: undefined, os: 'linux', arch: 'x64' });
					const { code, stderr } = runScript(script, home, stubBin);
					assert.strictEqual(code, 0, `script should succeed via the fallback, stderr: ${stderr}`);
					assert.ok(cliRunCount(home) >= 2, 'the fallback CLI should be --version-validated and then execd');
				} finally {
					cleanup();
				}
			});
			test('picks exactly one candidate when several pre-existing CLIs exist', function () {
				if (process.platform === 'win32') {
					return this.skip();
				}
				const { home, stubBin, cleanup } = makeFixture();
				try {
					seedFakeCli(`${home}/.vscode-cli-insider/code-insiders`);
					seedFakeCli(`${home}/.vscode-server-oss/code-insiders-${commit}`);
					seedFakeCli(`${home}/.vscode-server-oss/code-insiders-${'b'.repeat(40)}`);
					const script = composeAgentHostBootstrapScript({ serverDataFolderName: '.vscode-server-oss', quality: 'insider', commit: undefined, os: 'linux', arch: 'x64' });
					const { code, stderr } = runScript(script, home, stubBin);
					assert.strictEqual(code, 0, `script should exec a single fallback path, stderr: ${stderr}`);
				} finally {
					cleanup();
				}
			});
			test('fails loud when the download fails and no fallback CLI exists', function () {
				if (process.platform === 'win32') {
					return this.skip();
				}
				const { home, stubBin, cleanup } = makeFixture();
				try {
					const script = composeAgentHostBootstrapScript({ serverDataFolderName: '.vscode-server-oss', quality: 'insider', commit: undefined, os: 'linux', arch: 'x64' });
					const { code, stderr } = runScript(script, home, stubBin);
					assert.strictEqual(code, 1, 'script should exit 1');
					assert.ok(stderr.includes('no fallback CLI exists on this machine'), `expected the loud message, stderr: ${stderr}`);
				} finally {
					cleanup();
				}
			});
		});
		test('exports telemetry disablement for a custom command', () => {
			const script = composeAgentHostBootstrapScript({
				serverDataFolderName: '.vscode-server',
				quality: 'stable',
				commit: undefined,
				os: 'linux',
				arch: 'x64',
				telemetryLevel: TelemetryConfiguration.OFF,
				remoteAgentHostCommand: './start-agent-host',
			});
			assert.strictEqual(script, 'export VSCODE_AGENT_HOST_TELEMETRY_LEVEL=off && ./start-agent-host');
		});
	});
});
