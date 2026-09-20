/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isWeb } from '../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { ConditionalAuthState, conditionalAuthState, isAllowSignedOutWhenUsableEnabled, resolveSignedOutWindowGate, shouldShowGitHubWorkspaceGroupSignIn, SignedOutWindowGate } from '../../browser/sessionsAuthGate.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { AgentHostAllowSignedOutWhenUsableProductDefault, AgentHostAllowSignedOutWhenUsableSettingId } from '../../../platform/agentHost/common/agentService.js';
import { SessionTypeAuthRequirement } from '../../services/sessions/common/session.js';

suite('Sessions - Auth Gate', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the fork product default for signed-out use is on (D04)', () => {
		// Locks the single point of truth both registrations consume (workbench
		// settings schema + agent-host root-config schema). Importing the
		// registration modules themselves is not an option here: their side
		// effects (command registrations) collide with their own tests when
		// loaded in the same process, and the layering rules for this directory
		// do not allow reaching vs/workbench/contrib/** anyway.
		assert.strictEqual(AgentHostAllowSignedOutWhenUsableProductDefault, true);
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

	test('resolveSignedOutWindowGate exhaustively covers the D04 acceptance matrix', () => {
		// D04 AC2: `allowSignedOutWhenUsable=false` always forces GitHub sign-in;
		// `=true` with no advertised requirements stays unresolved; `=true` with at
		// least one non-GitHub requirement proceeds; `=true` with only GitHub
		// requirements still forces sign-in.
		assert.deepStrictEqual({
			disabledEmpty: resolveSignedOutWindowGate(false, []),
			disabledNone: resolveSignedOutWindowGate(false, [SessionTypeAuthRequirement.None]),
			disabledGitHub: resolveSignedOutWindowGate(false, [SessionTypeAuthRequirement.GitHub]),
			disabledUnusable: resolveSignedOutWindowGate(false, [SessionTypeAuthRequirement.Unusable]),
			enabledEmpty: resolveSignedOutWindowGate(true, []),
			enabledSingleGitHub: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub]),
			enabledAllGitHub: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.GitHub]),
			enabledSingleNone: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.None]),
			enabledSingleUnusable: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.Unusable]),
			enabledGitHubThenNone: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.None]),
			enabledGitHubThenUnusable: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.GitHub, SessionTypeAuthRequirement.Unusable]),
			enabledNoneThenGitHub: resolveSignedOutWindowGate(true, [SessionTypeAuthRequirement.None, SessionTypeAuthRequirement.GitHub]),
		}, {
			disabledEmpty: SignedOutWindowGate.ForceGitHubSignIn,
			disabledNone: SignedOutWindowGate.ForceGitHubSignIn,
			disabledGitHub: SignedOutWindowGate.ForceGitHubSignIn,
			disabledUnusable: SignedOutWindowGate.ForceGitHubSignIn,
			enabledEmpty: SignedOutWindowGate.Unresolved,
			enabledSingleGitHub: SignedOutWindowGate.ForceGitHubSignIn,
			enabledAllGitHub: SignedOutWindowGate.ForceGitHubSignIn,
			enabledSingleNone: SignedOutWindowGate.Proceed,
			enabledSingleUnusable: SignedOutWindowGate.Proceed,
			enabledGitHubThenNone: SignedOutWindowGate.Proceed,
			enabledGitHubThenUnusable: SignedOutWindowGate.Proceed,
			enabledNoneThenGitHub: SignedOutWindowGate.Proceed,
		});
	});

	test('isAllowSignedOutWhenUsableEnabled is always false on web and follows the setting on desktop', () => {
		// D04 AC3: the `!isWeb` guard means web never permits signed-out use, no
		// matter what the setting says. On desktop the setting decides. This suite
		// runs in a browser test host, where `isWeb` is true, so the guard branch
		// is the one exercised; the desktop branch is asserted structurally.
		const enabled = new TestConfigurationService({ [AgentHostAllowSignedOutWhenUsableSettingId]: true });
		const disabled = new TestConfigurationService({ [AgentHostAllowSignedOutWhenUsableSettingId]: false });
		const unset = new TestConfigurationService();
		assert.deepStrictEqual({
			enabled: isAllowSignedOutWhenUsableEnabled(enabled),
			disabled: isAllowSignedOutWhenUsableEnabled(disabled),
			unset: isAllowSignedOutWhenUsableEnabled(unset),
		}, {
			enabled: !isWeb,
			disabled: false,
			unset: false,
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
