/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeKeybinding } from '../../../../../base/common/keybindings.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { OS } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import '../../browser/sessionsActions.js';

const SHOW_SESSIONS_PICKER_COMMAND_ID = 'sessions.showSessionsPicker';
const CMD_G = decodeKeybinding(KeyMod.CtrlCmd | KeyCode.KeyG, OS)!.getHashCode();

/** Minimal {@link IContext} over a plain record of context key values. */
function context(values: Record<string, boolean>): IContext {
	return { getValue: <T>(key: string) => values[key] as T | undefined };
}

suite('Sessions - Show Sessions Picker keybinding (ISS-057 #17)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('Cmd/Ctrl+G opens the global thread search in the sessions window', () => {
		const rule = KeybindingsRegistry.getDefaultKeybindings()
			.find(item => item.command === SHOW_SESSIONS_PICKER_COMMAND_ID && item.keybinding?.getHashCode() === CMD_G)!;

		assert.ok(rule, 'sessions.showSessionsPicker is bound to Cmd/Ctrl+G');

		const evaluate = (values: Record<string, boolean>) => rule.when?.evaluate(context(values)) ?? true;

		assert.deepStrictEqual({
			regularWindow: evaluate({}),
			sessionsWindow: evaluate({ isSessionsWindow: true }),
			sessionsEditorArea: evaluate({ isSessionsWindow: true, editorAreaFocus: true }),
		}, {
			regularWindow: false,
			sessionsWindow: true,
			// Editor chords (Find Next / Go to Line) keep the key while an editor is focused.
			sessionsEditorArea: false,
		});
	});
});
