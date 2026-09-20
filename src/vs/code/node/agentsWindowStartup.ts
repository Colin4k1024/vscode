/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NativeParsedArgs } from '../../platform/environment/common/argv.js';
import { IProductService } from '../../platform/product/common/productService.js';

/**
 * Decides whether a startup with no explicit open intent opens the Agents
 * window as the product's default desktop form (agent-first), instead of
 * restoring or empty-opening a regular workbench window.
 *
 * Any explicit open intent keeps the classic behavior so the regular
 * workbench window remains fully reachable:
 *
 * - file/folder/workspace arguments (`args._`, `--folder-uri`, `--file-uri`)
 * - `--new-window` / `--reuse-window`, `--profile` / `--profile-temp`
 * - macOS `open-file` events delivered at launch
 * - editor-centric modes: `--wait`, `--diff`, `--merge`, `--remote`
 *
 * Gated on `product.defaultWindow === 'agents'`; without the product flag
 * this predicate always returns `false` and startup behavior is unchanged.
 */
export function shouldOpenAgentsWindowOnStartup(productService: IProductService, args: NativeParsedArgs, macOpenFiles: readonly string[]): boolean {
	if (productService.defaultWindow !== 'agents') {
		return false;
	}

	if (args.agents) {
		// handled by the dedicated `--agents` branch
		return false;
	}

	// Explicit open intents
	if (args._.length > 0 || args['folder-uri'] !== undefined || args['file-uri'] !== undefined) {
		return false;
	}
	if (args['new-window'] || args['reuse-window']) {
		return false;
	}
	if (args.profile !== undefined || args['profile-temp']) {
		return false;
	}
	if (macOpenFiles.length > 0) {
		return false;
	}

	// Editor-centric modes
	if (args.wait || args.diff || args.merge || args.remote !== undefined) {
		return false;
	}

	// Extension development/testing: the sessions window's extension host is
	// allow-listed, so a dev extension would silently never load there.
	if (args.extensionDevelopmentPath !== undefined || args.extensionTestsPath !== undefined) {
		return false;
	}

	return true;
}
