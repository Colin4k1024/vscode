#!/bin/bash
# One-shot local bootstrap for the Codex Desktop workspace (D01).
# Tested on macOS arm64 (darwin 25.6.0); see BOOTSTRAP.md for the full write-up.
#
# Installs Node from .nvmrc into a repo-local prefix (.build/node24, via `n`),
# installs dependencies with a repo-local npm cache, compiles the client, and
# downloads Electron + built-in extensions.
#
# Prerequisite: the `n` version manager (https://github.com/tj/n) on PATH.
# Alternatives that satisfy the same .nvmrc pin are listed by the guard below
# (fnm / nvm / volta); this script itself only drives `n`.
#
# Idempotent, but the guards check the *end states* the later steps depend on,
# not just the first artifact: a partially-installed tree (e.g. a postinstall
# that died on a network error after the root install) re-runs the missing
# parts. Use --force to redo everything unconditionally.
#
# Rollback: rm -rf .build/node24 .build/npm-cache .build/electron \
#                  .build/builtInExtensions node_modules out
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

export N_PREFIX="$PWD/.build/node24"
mkdir -p "$N_PREFIX" .build/logs .build/npm-cache
export npm_config_cache="$PWD/.build/npm-cache"
# See BOOTSTRAP.md §6c: these leak from agent environments and break Electron.
unset ELECTRON_RUN_AS_NODE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS || true

# 1. Node per .nvmrc, installed to a repo-local prefix (global node untouched).
if ! command -v n >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: `n` (node version manager) is not on PATH, and this script drives `n`
to install the Node version pinned by .nvmrc into a repo-local prefix.

Pick ONE of the following, then re-run:
  n:     brew install n            (what this script uses)
  fnm:   brew install fnm && fnm use   # reads .nvmrc directly
  nvm:   brew install nvm; nvm install && nvm use
  volta: brew install volta; volta run node --version
Any tool that puts Node v24.18.0+ (major 24) on PATH with `npm` < 13 works;
build/npm/preinstall.ts enforces the exact floor.
EOF
  exit 1
fi

if [[ $FORCE -eq 1 ]] || [[ ! -x "$N_PREFIX/bin/node" ]] || [[ "$("$N_PREFIX/bin/node" -v)" != "v$(cat .nvmrc)" ]]; then
  n "$(cat .nvmrc)"
fi
export PATH="$N_PREFIX/bin:$PATH"
echo "node=$(node -v) npm=$(npm -v)"

# 2. Dependencies. Guard on the root lockfile AND a known deep sub-install
# marker: `npm ci` can die in postinstall on a transient network error while
# the root node_modules is already complete (BOOTSTRAP.md §3), and the root
# lockfile alone cannot tell the two apart. postinstall.ts re-runs just the
# sub-installs and is idempotent.
if [[ $FORCE -eq 1 ]] || [[ ! -f node_modules/.package-lock.json ]] || [[ ! -d extensions/copilot/node_modules/@vscode/copilot-api ]]; then
  if [[ -f node_modules/.package-lock.json ]]; then
    # Root install finished earlier; only the sub-installs are missing.
    node build/npm/postinstall.ts 2>&1 | tee .build/logs/postinstall.log
  else
    npm ci --cache "$npm_config_cache" 2>&1 | tee .build/logs/install.log \
      || node build/npm/postinstall.ts 2>&1 | tee .build/logs/postinstall.log
  fi
fi

# 3. Compile. `npm run compile` (NOT transpile-client) so that extensions/*/out
# exists too — without it the app fails to load extension main entrypoints
# (acceptance #2 requires BOTH out/ and extensions/*/out/). The guard requires
# a meaningful number of compiled extensions, not just one: 32 at the time of
# writing; >= 8 keeps the check stable against upstream churn while still
# catching a compile that died after the first extension.
# NB: `find` (not `ls extensions/*/out`) — a glob with zero matches makes `ls`
# exit 1, which under `set -euo pipefail` would abort the script on exactly
# the clean-checkout case this script exists to bootstrap.
EXT_OUT_COUNT=$(find extensions -mindepth 2 -maxdepth 2 -type d -name out 2>/dev/null | wc -l | tr -d ' ')
echo "extensions with out/: ${EXT_OUT_COUNT}"
if [[ $FORCE -eq 1 ]] || [[ ! -d out/vs ]] || [[ "$EXT_OUT_COUNT" -lt 8 ]]; then
  npm run compile 2>&1 | tee .build/logs/compile.log
fi

# 4. Electron and built-in extensions
if [[ $FORCE -eq 1 ]] || [[ ! -d .build/electron ]]; then
  npm run electron
fi
if [[ $FORCE -eq 1 ]] || [[ ! -d .build/builtInExtensions ]]; then
  npm run download-builtin-extensions
fi

echo "ready. Launch:"
echo "  ./scripts/code.sh            # editor window"
echo "  ./scripts/code.sh --agents   # Agents window (GitHub sign-in wall until D04)"
