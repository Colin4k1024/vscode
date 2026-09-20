/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ChangesetKind, parseChangesetUri } from '../common/changesetUri.js';
import type { IChangesetOperationContribution, IChangesetOperationContext, IChangesetOperationRegistry } from '../common/agentHostChangesetOperationService.js';
import { ChangesetOperationScope, ChangesetOperationStatus, type ChangesetOperation } from '../common/state/sessionState.js';
import { AgentHostDiscardChangesOperationHandler } from './agentHostDiscardChangesOperationHandler.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';

export class AgentHostDiscardChangesOperationContribution extends Disposable implements IChangesetOperationContribution {

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	registerHandlers(registry: IChangesetOperationRegistry): IDisposable {
		const store = new DisposableStore();
		const getSessionState = (sessionKey: string) => this._stateManager.getSessionState(sessionKey);
		const handler = this._instantiationService.createInstance(AgentHostDiscardChangesOperationHandler, getSessionState);
		store.add(registry.registerChangesetOperationHandler(AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES, {
			invoke: async (params, token) => {
				const result = await handler.invoke(params, token);
				// `git restore` replaces the file atomically, which file watchers
				// may not surface (e.g. when the recursive watcher backend is
				// unavailable), so refresh the session git state explicitly to
				// republish the affected changesets. Not awaited: the refresh is
				// rate-limited to one run per 5s per session and would otherwise
				// delay the operation response past the client's timeout.
				const parsed = parseChangesetUri(params.channel);
				if (parsed) {
					void registry.refreshSessionGitState(parsed.sessionUri);
				}
				return result;
			}
		}));

		return store;
	}

	getOperations({ changesetKind, gitState }: IChangesetOperationContext): ChangesetOperation[] {
		if (changesetKind !== ChangesetKind.Uncommitted || (gitState?.uncommittedChanges ?? 0) <= 0) {
			return [];
		}

		return [{
			id: AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES,
			label: localize('agentHost.changeset.discardChanges', "Discard Changes"),
			confirmation: localize('agentHost.changeset.discardChanges.confirmation', "Are you sure you want to discard the changes in \'{0}\'? This action cannot be undone."),
			icon: 'discard',
			scopes: [ChangesetOperationScope.Resource],
			status: ChangesetOperationStatus.Idle,
		} satisfies ChangesetOperation];
	}
}
