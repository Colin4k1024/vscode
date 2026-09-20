/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { encodeHex, VSBuffer } from '../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IRemoteAgentHostEntry, IRemoteAgentHostSSHConnection, RemoteAgentHostEntryType } from '../../../platform/agentHost/common/remoteAgentHostService.js';
import { resolveRemoteAgentHostEntryAuthority, sshAuthorityString } from '../../browser/openInVSCodeUtils.js';

function entry(connection: IRemoteAgentHostEntry['connection']): IRemoteAgentHostEntry {
	return { name: 'test', connection };
}

suite('openInVSCodeUtils - cross-window session interop (D07)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('sshAuthorityString', () => {

		test('plain hostname passes through unencoded', () => {
			const connection: IRemoteAgentHostSSHConnection = { type: RemoteAgentHostEntryType.SSH, address: 'localhost:1', hostName: 'myhost' };
			assert.strictEqual(sshAuthorityString(connection), 'myhost');
		});

		test('user/port or special characters hex-encode the SSH authority JSON', () => {
			const withUser: IRemoteAgentHostSSHConnection = { type: RemoteAgentHostEntryType.SSH, address: 'localhost:1', hostName: 'myhost', user: 'alice' };
			assert.strictEqual(
				sshAuthorityString(withUser),
				encodeHex(VSBuffer.fromString(JSON.stringify({ hostName: 'myhost', user: 'alice' }))),
			);

			const withPort: IRemoteAgentHostSSHConnection = { type: RemoteAgentHostEntryType.SSH, address: 'localhost:1', hostName: 'myhost', port: 2222 };
			assert.strictEqual(
				sshAuthorityString(withPort),
				encodeHex(VSBuffer.fromString(JSON.stringify({ hostName: 'myhost', port: 2222 }))),
			);

			// Uppercase / characters outside the safe set force encoding too.
			const upper: IRemoteAgentHostSSHConnection = { type: RemoteAgentHostEntryType.SSH, address: 'localhost:1', hostName: 'MyHost' };
			assert.strictEqual(sshAuthorityString(upper), encodeHex(VSBuffer.fromString(JSON.stringify({ hostName: 'MyHost' }))));
		});
	});

	suite('resolveRemoteAgentHostEntryAuthority', () => {

		test('ssh config host takes precedence over the raw hostname', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.SSH,
				address: 'localhost:1',
				sshConfigHost: 'myserver',
				hostName: 'myserver.example.com',
			})), 'ssh-remote+myserver');
		});

		test('ssh without config host falls back to the encoded hostname', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.SSH,
				address: 'localhost:1',
				hostName: 'myserver.example.com',
			})), 'ssh-remote+myserver.example.com');
		});

		test('tunnel uses the label when present and the id otherwise', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.Tunnel,
				tunnelId: 'tid',
				clusterId: 'euw',
				label: 'dev-box',
			})), 'tunnel+dev-box');
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.Tunnel,
				tunnelId: 'tid',
				clusterId: 'euw',
			})), 'tunnel+tid.euw');
		});

		test('wsl maps to the Remote WSL authority', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.WSL,
				address: 'wsl:Ubuntu-22.04',
				distro: 'Ubuntu-22.04',
			})), 'wsl+Ubuntu-22.04');
		});

		test('dev container hex-encodes the host path', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.DevContainer,
				address: 'devcontainer:/repo',
				hostPath: '/repo',
			})), `dev-container+${encodeHex(VSBuffer.fromString('/repo'))}`);
		});

		test('websocket and cloud sandbox have no VS Code remote authority', () => {
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.WebSocket,
				address: 'localhost:8080',
			})), undefined);
			assert.strictEqual(resolveRemoteAgentHostEntryAuthority(entry({
				type: RemoteAgentHostEntryType.CloudSandbox,
				address: 'cloudsandbox:env_1',
				environmentId: 'env_1',
			})), undefined);
		});
	});
});
