/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { AgentHostCodexPreferOpenAIProviderSettingId, IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostConfigKey } from '../../../../../../platform/agentHost/common/agentHostCustomizationConfig.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../../../common/contributions.js';
import { AgentHostRootConfigForwarder, type IForwardedRootConfigKey } from './agentHostRootConfigForwarder.js';

/**
 * Forwards the `chat.agentHost.codexPreferOpenAIProvider` policy flag (D05/#7)
 * into the **local** agent host's root config under the short key
 * {@link AgentHostConfigKey.CodexPreferOpenAIProvider}, mirroring the
 * two-reader contract of the signed-out opt-in: the workbench reads the VS
 * Code setting directly, while the node-side Codex agent reads the root-config
 * bag (keyed only by short keys), so the flag must be mirrored here or the
 * node side would never see it. Gated on Agent Host runtime availability. The
 * schema-gate / hydration-retry / loop-guard machinery lives in the shared
 * {@link AgentHostRootConfigForwarder}; this contribution only declares the
 * key.
 */
export class AgentHostCodexDefaultsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentHostCodexDefaults';

	private readonly _forwarder: AgentHostRootConfigForwarder;

	constructor(
		@IAgentHostService agentHostService: IAgentHostService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAgentHostEnablementService private readonly _agentHostEnablementService: IAgentHostEnablementService,
	) {
		super();

		const keys: readonly IForwardedRootConfigKey[] = [
			{
				key: AgentHostConfigKey.CodexPreferOpenAIProvider,
				computeValue: () => this._configurationService.getValue<boolean>(AgentHostCodexPreferOpenAIProviderSettingId) === true,
				registerTriggers: (store, push) => {
					const flagChanged = Event.filter(this._configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(AgentHostCodexPreferOpenAIProviderSettingId), store);
					store.add(flagChanged(() => push()));
				},
			},
		];
		this._forwarder = this._register(new AgentHostRootConfigForwarder(keys, agentHostService));

		this._register(autorun(reader => {
			if (this._agentHostEnablementService.enabled.read(reader)) {
				this._forwarder.start();
			} else {
				this._forwarder.stop();
			}
		}));
	}
}
