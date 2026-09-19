#!/bin/bash
# One-shot local bootstrap for the Codex Desktop workspace (D01).
# Tested on macOS arm64 (darwin 25.6.0); see BOOTSTRAP.md for the full write-up.
#
# Installs Node from .nvmrc into a repo-local prefix (.build/node24, via `n`),
# installs dependencies with a repo-local npm cache, compiles the client, and
# downloads Electron + built-in extensions. Idempotent: every step is skipped
# when its output already exists.
#
# Rollback: rm -rf .build/node24 .build/npm-cache .build/electron \
#                  .build/builtInExtensions node_modules out
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

export N_PREFIX="$PWD/.build/node24"
mkdir -p "$N_PREFIX" .build/logs .build/npm-cache
export npm_config_cache="$PWD/.build/npm-cache"
# See BOOTSTRAP.md §6c: these leak from agent environments and break Electron.
unset ELECTRON_RUN_AS_NODE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS || true

# 1. Node per .nvmrc, installed to a repo-local prefix (global node untouched)
if [[ ! -x "$N_PREFIX/bin/node" ]] || [[ "$("$N_PREFIX/bin/node" -v)" != "v$(cat .nvmrc)" ]]; then
  n "$(cat .nvmrc)"
fi
export PATH="$N_PREFIX/bin:$PATH"
echo "node=$(node -v) npm=$(npm -v)"

# 2. Dependencies. `npm ci` can die in postinstall on a transient network error
# while the root node_modules is already complete; postinstall.ts re-runs just
# the sub-installs and is idempotent (BOOTSTRAP.md §3).
if [[ ! -f node_modules/.package-lock.json ]]; then
  npm ci --cache "$npm_config_cache" 2>&1 | tee .build/logs/install.log \
    || node build/npm/postinstall.ts 2>&1 | tee .build/logs/postinstall.log
fi

# 3. Compile. `npm run compile` (NOT transpile-client) so that extensions/*/out
# exists too — without it the app fails to load extension main entrypoints.
if [[ ! -d out/vs ]] || [[ $(ls -d extensions/*/out 2>/dev/null | wc -l) -eq 0 ]]; then
  npm run compile 2>&1 | tee .build/logs/compile.log
fi

# 4. Electron and built-in extensions
[[ -d .build/electron ]] || npm run electron
[[ -d .build/builtInExtensions ]] || npm run download-builtin-extensions

echo "ready. Launch:"
echo "  ./scripts/code.sh            # editor window"
echo "  ./scripts/code.sh --agents   # Agents window (GitHub sign-in wall until D04)"
