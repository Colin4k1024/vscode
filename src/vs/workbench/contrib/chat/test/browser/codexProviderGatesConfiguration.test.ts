/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { AgentHostCodexAgentEnabledSettingId, CodexPreferAgentHostEditorSettingId } from '../../../../../platform/agentHost/common/agentService.js';
import { ChatConfiguration } from '../../common/constants.js';
import '../../browser/chat.shared.contribution.js';
import '../../../../../platform/agentHost/common/agentHostStarter.config.contribution.js';

const configurationProperties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();

suite('Codex provider gates configuration (D07)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('Codex provider gates default identically in both window forms (AC6)', () => {
		// The Agents window reads `chat.agentHost.codexAgent.enabled` and the
		// regular workbench reads `chat.editor.codex.preferAgentHost`. Keeping
		// the two registered defaults identical is what makes Codex surface
		// consistently across both window forms under the product default.
		const agentsWindowGate = configurationProperties[AgentHostCodexAgentEnabledSettingId];
		const editorWindowGate = configurationProperties[CodexPreferAgentHostEditorSettingId];

		assert.ok(agentsWindowGate, `${AgentHostCodexAgentEnabledSettingId} is registered`);
		assert.ok(editorWindowGate, `${CodexPreferAgentHostEditorSettingId} is registered`);
		assert.strictEqual(typeof agentsWindowGate.default, 'boolean');
		assert.strictEqual(agentsWindowGate.default, editorWindowGate.default);
	});

	test('running-turn composer default is steer: Enter injects, Alt+Enter queues (ISS-057 #10)', () => {
		const queueingDefault = configurationProperties[ChatConfiguration.RequestQueueingDefaultAction];

		assert.deepStrictEqual({
			default: queueingDefault?.default,
			enum: queueingDefault?.enum,
		}, {
			default: 'steer',
			enum: ['queue', 'steer'],
		});
	});
});
