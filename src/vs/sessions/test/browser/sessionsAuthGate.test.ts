/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isWeb } from '../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { ConditionalAuthState, conditionalAuthState, isAllowSignedOutWhenUsableEnabled, resolveSignedOutWindowGate, shouldShowGitHubWorkspaceGroupSignIn, SignedOutWindowGate } from '../../browser/sessionsAuthGate.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { AgentHostAllowSignedOutWhenUsableSettingId } from '../../../platform/agentHost/common/agentService.js';
import { SessionTypeAuthRequirement } from '../../services/sessions/common/session.js';

suite('Sessions - Auth Gate', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the fork product registers signed-out use as the default (D04)', () => {
		// Locks the actual behavior change of D04/#6: if a rebase reintroduces
		// `default: false` or the setting id changes, this fails even though the
		// gate-logic tests below would stay green.
		const registered = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
			.getConfigurationProperties()[AgentHostAllowSignedOutWhenUsableSettingId];
		assert.ok(registered, `setting ${AgentHostAllowSignedOutWhenUsableSettingId} is not registered`);
		assert.strictEqual(registered.default, true);
	});

	test('signed-out use stays gated to desktop: enabled state is exactly `!isWeb` when the setting is on', () => {
		// D04/#6 acceptance: web always requires sign-in. In a web context this
		// asserts the `!isWeb` guard keeps the feature off even with the setting
		// on; in an Electron renderer it asserts the same expression forwards
		// `true`, so the test is meaningful in whichever suite loads it.
		const configurationService = new TestConfigurationService({ [AgentHostAllowSignedOutWhenUsableSettingId]: true });
		assert.strictEqual(isAllowSignedOutWhenUsableEnabled(configurationService), !isWeb);
	});

	test('blocking sign-in requires the opt-in and a provider that does not need GitHub', () => {
		assert.deepStrictEqual({
			featureDisabled: resolveSignedOutWindowGate(false, [SessionTypeAuthRequirement.None]),
			providersUnresolved: resolveSignedOutWindowGate(true, []),
			allRequireGitHub: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.GitHub]),
			nativeProvider: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.None]),
			nativeProviderInitializing: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.Unusable]),
		}, {
			featureDisabled: SignedOutWindowGate.ForceGitHubSignIn,
			providersUnresolved: SignedOutWindowGate.Unresolved,
			allRequireGitHub: SignedOutWindowGate.ForceGitHubSignIn,
			nativeProvider: SignedOutWindowGate.Proceed,
			nativeProviderInitializing: SignedOutWindowGate.Proceed,
		});
	});

	test('GitHub workspace group offers sign-in only for signed-out opted-in users', () => {
		assert.deepStrictEqual([
			shouldShowGitHubWorkspaceGroupSignIn(false, false),
			shouldShowGitHubWorkspaceGroupSignIn(false, true),
			shouldShowGitHubWorkspaceGroupSignIn(true, false),
			shouldShowGitHubWorkspaceGroupSignIn(true, true),
		], [false, true, false, false]);
	});

	test('conditionalAuthState treats an unresolved account as unknown, never signed out', () => {
		// The root-cause distinction: before the account resolves, its snapshot is
		// null for signed-in and signed-out users alike, so `accountResolved: false`
		// must map to Unresolved regardless of the (untrustworthy) signedIn snapshot —
		// otherwise the conditional-auth UI flashes a sign-in modal at a signed-in
		// user during startup.
		const cases = [
			{ accountResolved: false, signedIn: false },
			{ accountResolved: false, signedIn: true },
			{ accountResolved: true, signedIn: false },
			{ accountResolved: true, signedIn: true },
		];

		assert.deepStrictEqual(cases.map(c => conditionalAuthState(c.accountResolved, c.signedIn)), [
			ConditionalAuthState.Unresolved,
			ConditionalAuthState.Unresolved,
			ConditionalAuthState.SignedOut,
			ConditionalAuthState.SignedIn,
		]);
	});
});
