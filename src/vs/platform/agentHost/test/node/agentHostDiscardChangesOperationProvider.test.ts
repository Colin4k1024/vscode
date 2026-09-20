/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import type { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { InstantiationService } from '../../../instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../instantiation/common/serviceCollection.js';
import { ILogService, NullLogService } from '../../../log/common/log.js';
import { buildUncommittedChangesetUri } from '../../common/changesetUri.js';
import { AgentHostDiscardChangesOperationHandler } from '../../node/agentHostDiscardChangesOperationHandler.js';
import { AgentHostDiscardChangesOperationContribution } from '../../node/agentHostDiscardChangesOperationProvider.js';
import { IAgentHostGitService } from '../../common/agentHostGitService.js';
import type { IChangesetOperationHandler, IChangesetOperationRegistry } from '../../common/agentHostChangesetOperationService.js';
import { ChangesetOperationTargetKind, type InvokeChangesetOperationParams } from '../../common/state/protocol/channels-changeset/commands.js';
import { SessionStatus } from '../../common/state/sessionState.js';
import { AgentHostStateManager } from '../../node/agentHostStateManager.js';

const sessionKey = 'agent:/session';

function makeResourceTarget(resource: URI): InvokeChangesetOperationParams['target'] {
	return { kind: ChangesetOperationTargetKind.Resource, resource: resource.toString() as unknown as InvokeChangesetOperationParams['channel'] };
}

suite('AgentHostDiscardChangesOperationContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(disposables: Pick<DisposableStore, 'add'>): {
		registry: IChangesetOperationRegistry;
		getHandler: () => IChangesetOperationHandler;
		gitService: { restore: () => Promise<void>; restoreError: Error | undefined };
		refreshedSessions: string[];
	} {
		const refreshedSessions: string[] = [];
		const gitService = {
			restoreError: undefined as Error | undefined,
			async restore(): Promise<void> {
				if (this.restoreError) {
					throw this.restoreError;
				}
			},
		};
		const stateManager = disposables.add(new AgentHostStateManager(new NullLogService()));
		stateManager.createSession({
			resource: sessionKey,
			provider: 'copilot',
			title: 'Session',
			status: SessionStatus.Idle,
			createdAt: new Date(1).toISOString(),
			modifiedAt: new Date(1).toISOString(),
			workingDirectories: [URI.file('/repo').toString()],
		});
		const instantiationService = disposables.add(new InstantiationService(new ServiceCollection(
			[IAgentHostGitService, gitService],
			[ILogService, new NullLogService()],
		)));
		const contribution = disposables.add(new AgentHostDiscardChangesOperationContribution(stateManager, instantiationService));

		let handler: IChangesetOperationHandler | undefined;
		const registry: IChangesetOperationRegistry = {
			registerChangesetOperationHandler: (_operationId, h) => {
				handler = h;
				return { dispose: () => { } };
			},
			refreshSessionGitState: async (session) => { refreshedSessions.push(session); },
			onDidChangeOperations: () => { },
		};
		disposables.add(contribution.registerHandlers(registry));

		return { registry, getHandler: () => { assert.ok(handler); return handler; }, gitService, refreshedSessions };
	}

	test('refreshes the session git state after a successful discard', async () => {
		const { getHandler, refreshedSessions } = setup(disposables);

		// The file watcher is not guaranteed to observe the atomic `git restore`
		// replace, so the operation itself must kick a git-state refresh to
		// republish the affected changesets.
		await getHandler().invoke({
			channel: buildUncommittedChangesetUri(sessionKey),
			operationId: AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES,
			target: makeResourceTarget(URI.file('/repo/src/file.ts')),
		}, CancellationToken.None);

		assert.deepStrictEqual(refreshedSessions, [sessionKey]);
	});

	test('does not refresh the session git state when the discard fails', async () => {
		const { getHandler, gitService, refreshedSessions } = setup(disposables);
		gitService.restoreError = new Error('restore failed');

		await assert.rejects(() => getHandler().invoke({
			channel: buildUncommittedChangesetUri(sessionKey),
			operationId: AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES,
			target: makeResourceTarget(URI.file('/repo/src/file.ts')),
		}, CancellationToken.None));

		assert.deepStrictEqual(refreshedSessions, []);
	});
});
