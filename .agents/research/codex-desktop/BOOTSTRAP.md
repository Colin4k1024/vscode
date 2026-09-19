# BOOTSTRAP.md — 从零到可运行的 Code OSS + Codex（macOS arm64 实测）

对应 Issue：[#3 D01](https://github.com/Colin4k1024/vscode/issues/3)
实测日期：2026-09-19　实测机器：macOS arm64 (darwin25.6.0)
仓库基线：`fb20064c0f4`（code-oss-dev 1.139.0）

**本文件里的每一条命令都实测跑通过，每一个数字都是实测值。**

---

## 0. 前置检查

```bash
cd /path/to/vscode

# 工具链（本机实测值）
xcode-select -p          # → /Library/Developer/CommandLineTools
clang --version          # → Apple clang 21.0.0 (clang-2100.3.34.2)
python3 --version        # → Python 3.11.5   (node-gyp 需要)
make --version           # → GNU Make 3.81
command -v n             # → /usr/local/bin/n   ← bootstrap.sh 的硬前置（见 §1）
df -h .                  # → 需要 ~3GB 空闲（node_modules 1.4G + electron 300M + out 404M + npm-cache）

cat .nvmrc               # → 24.18.0   ← 硬性要求，见 §1
node -v                  # 若 major ≠ 24，必须换 node
```

> **`n` 是 `bootstrap.sh` 的硬前置**：脚本用它把 `.nvmrc` 的 Node 装进仓库本地前缀 `.build/node24`。
> 没有任何一个版本管理器时的替代方案（任选其一，把 Node 24.18.0+ 放上 PATH 即可，`build/npm/preinstall.ts` 只校验版本不校验来源）：
> - `n`：`brew install n`（本脚本默认驱动）
> - `fnm`：`brew install fnm && fnm use`（直接读 `.nvmrc`）
> - `nvm`：`brew install nvm; nvm install && nvm use`
> - `volta`：`brew install volta`（ volta 会按 package.json `engines` 自动切换；本仓库未声明 engines，需 `volta pin node@24` 或手动确保版本）

`.npmrc` 里的关键事实（影响后续步骤）：

| 文件 | 字段 | 值 |
|---|---|---|
| `.npmrc` | `target` | **43.6.0**（Electron 版本） |
| `.npmrc` | `disturl` | `https://electronjs.org/headers` |
| `.npmrc` | `build_from_source` | **`true`** ← 原生模块从源码编译，必须有 C++ 工具链 |
| `remote/.npmrc` | `target` | **24.20.0**（remote server 的 Node） |

---

## 1. Node 24 —— 装到仓库本地前缀，**不改全局**

### 为什么必须换

`build/npm/preinstall.ts:13-38` 是硬校验：

```ts
if (majorNodeVersion !== requiredMajor ||
    minorNodeVersion < requiredMinor ||
    (minorNodeVersion === requiredMinor && patchNodeVersion < requiredPatch)) {
    console.error(`*** Please use Node.js v${requiredVersion} or newer with the same major version ...`);
    throw new Error();
}
```

即 **major 必须相等，minor/patch 不得低于 `.nvmrc`**。全局 node v22 → 必然失败。

### 推荐做法（可逆、零全局副作用）

```bash
export N_PREFIX="$PWD/.build/node24"
mkdir -p "$N_PREFIX"
n 24.18.0
export PATH="$PWD/.build/node24/bin:$PATH"

node -v    # → v24.18.0
npm -v     # → 11.16.0    （必须 < 13，见 preinstall.ts:50）
```

- `.build/` 已在 `.gitignore:8`，不进 git 状态
- **回滚 = `rm -rf .build/node24`**
- 全局 `/opt/homebrew/bin/node` 保持 v22.22.2 不变，不影响本机其他项目

实测输出：
```
  installing : node-v24.18.0
       fetch : https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.xz
   installed : v24.18.0 to /…/.build/node24/bin/node
      active : v22.22.2 at /opt/homebrew/bin/node     ← 全局未被改动
```

### 备选

| 方式 | 评价 |
|---|---|
| `brew install node@24` | 会改全局默认 node，可能影响其他项目 |
| `fnm` / `nvm` / `volta` / `asdf` / `mise` | 本机均未安装；若有则优先用（`fnm use` 会读 `.nvmrc`） |
| `VSCODE_SKIP_NODE_VERSION_CHECK=1` | **不要用** —— 跳过校验后原生模块会按错误的 ABI 编译 |

> 后续所有命令都假设 `PATH` 已含 `$PWD/.build/node24/bin`。建议写进一个 `.envrc` 或每次开新 shell 时 export。

---

## 2. npm 缓存 —— 绕开 root 文件，**不要用 sudo**

### 症状

```
npm error code EACCES
npm error syscall open
npm error path /Users/<you>/.npm/_cacache/index-v5/ee/69/89d1f22...
npm error Your cache folder contains root-owned files, due to a bug in previous
npm error versions of npm which has since been addressed.
npm error To permanently fix this problem, please run:
npm error   sudo chown -R 501:20 "/Users/<you>/.npm"
npm ci EXIT=243
```

先确认是不是这个问题：

```bash
find ~/.npm -user root 2>/dev/null | wc -l     # 本机实测 = 65
```

这些是历史 `sudo npm ...` 的遗留，**与 VS Code 无关**，但会 100% 阻断首次 install。

### 解法（零 sudo、零全局副作用、可逆）

```bash
export npm_config_cache="$PWD/.build/npm-cache"
mkdir -p "$npm_config_cache"
```

> npm 提示的 `sudo chown -R 501:20 ~/.npm` 会修改用户全局目录归属且不可逆。**不要跑。**
> 本地缓存目录同样在 `.build/` 下（已 gitignore），回滚 = 删目录。
> 代价：首次 install 无法复用全局缓存，会多下载一遍（本机实测总耗时仍只有 ~7 min）。

---

## 3. 安装依赖

```bash
npm ci --cache "$npm_config_cache" 2>&1 | tee .build/logs/install.log
```

### 如果 postinstall 阶段 ECONNRESET

根 `npm ci` 会并行给 ~90 个 `extensions/*`、`remote/*`、`test/*`、`.vscode/extensions/*` 目录跑子安装，其中任一个遇到瞬时网络错误就会让整个 `npm ci` 以 EXIT=1 结束——**但根 `node_modules` 其实已经装完了**。

判定：
```bash
ls node_modules/.package-lock.json          # 存在 → 根安装已成功
grep -c "npm error" .build/logs/install.log # 只有 ECONNRESET 类 → 瞬时网络
grep "ECONNRESET" .build/logs/install.log
```

修复（**幂等，不需要重跑整个 `npm ci`**）：
```bash
node build/npm/postinstall.ts 2>&1 | tee .build/logs/postinstall.log
echo $?    # → 0
```

本机实测：第一次 `npm ci` 在 `.vscode/extensions/vscode-pr-pinger` 之后 ECONNRESET 失败；单独重跑 postinstall → **EXIT=0，零错误**，耗时约 2 min。

### 实测耗时与产物

| 阶段 | 耗时 | 产物 |
|---|---|---|
| `npm ci` | ~5 min（失败）+ ~2 min（postinstall 重跑） | `node_modules` **1.4G** |

关键落地校验：
```bash
ls node_modules/@openai
# → codex   codex-darwin-arm64

node -e "console.log(require('./node_modules/@openai/codex/package.json').version)"
# → 0.153.0    ← 与 build/codex/codex-version.txt 精确一致

ls -la node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/
# → -rwxr-xr-x  220452192  codex
# → -rwxr-xr-x   62785312  codex-code-mode-host

node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex --version
# → codex-cli 0.153.0
```

**这就是 Codex 的 dev fallback 路径**（`codexAgent.ts:resolveCodexDevSdkRoot`，`_resolveSdkRoot` 的第 2 级）——
装完依赖后 **不需要任何 env override** 就能跑 Codex。

### `extensions/copilot` 的私有依赖：无需 GitHub Packages 凭据

原以为是高风险点，实测**不是**（全程未设 `GITHUB_TOKEN`、未配私有 registry）：

```
[extensions/copilot] added 1148 packages, and audited 1149 packages in 2m
[extensions/copilot] 13 vulnerabilities (1 low, 11 moderate, 1 high)
[extensions/copilot] Creating symlinks for Claude session storage and instructions...

ls -d extensions/copilot/node_modules/@github/copilot      # ✅
ls -d extensions/copilot/node_modules/@vscode/copilot-api  # ✅
```

⚠️ 那 13 个 vulnerability（含 1 high）需由 [#10 D08](https://github.com/Colin4k1024/vscode/issues/10) 裁定是否随产品分发。

### postinstall 的两个副作用（值得注意）

```
[.] Created symlink .claude/skills -> .agents/skills
[.] Patched foundry-local-sdk coreInterop.js (on-demand native runtime override)
```

第二条是**在 install 期间给 node_modules 内的文件打补丁**。是否进入打包产物、`foundry-local-sdk` 的许可如何 → 归 [#10 D08](https://github.com/Colin4k1024/vscode/issues/10) 与 [#12 D10](https://github.com/Colin4k1024/vscode/issues/12)。

---

## 4. 编译

```bash
npm run compile 2>&1 | tee .build/logs/compile.log
```

`npm run compile` = `npm-run-all2 -lp compile-client compile-copilot`，两者**必须都成功**：
- `compile-client` = `npm run gulp compile`（monaco-typecheck + clean out + copyCodicons + api-proposal-names + extension-point-names + compile src→out + compile-extensions + compile-extension-media）
- `compile-copilot` = `npm --prefix extensions/copilot run compile`

### 实测：**20 秒**，零错误

比预期快得多，因为用的是 **tsgo（TypeScript native preview）+ esbuild**，不是 `tsc` emit。

```
[14:40:25] Starting 'compile'...
[14:40:29] Finished extensions …/github/tsconfig.json with 0 errors.
[14:40:30] Finished compilation extension-point-names with 0 errors after 4267 ms
[14:40:38] Finished monaco-typecheck after 12598 ms
[14:40:44] Finished compile-src …/src/tsconfig.json with 0 errors.
[14:40:45] Finished compilation with 0 errors after 10260 ms
[14:40:45] Finished 'compile' after 20 s
```

### 产物校验（**这一步不能省**）

`.agents/skills/launch/SKILL.md` 明确警告过这个坑：
> A common cause: you ran `npm run transpile-client` to satisfy unit tests, which populated `out/` but **not** `extensions/*/out/`, so preLaunch's "is `out/` missing?" check skipped the compile.

```bash
du -sh out/                              # → 404M
ls -d extensions/*/out | wc -l           # → 32      ← 必须 > 0
ls extensions/copilot/dist | wc -l       # → 41
ls out/vs/platform/agentHost/node/codex/ | wc -l   # → 27（含 codexAgent.js）
ls out/vs/code/electron-main/app.js      # ✅
```

若 `extensions/*/out` 为 0 → 启动时会报 `Cannot find module .../extensions/.../out/extension.js`，重跑 `npm run compile`（**不是** `transpile-client`）。

---

## 5. 下载 Electron 与 built-in extensions

```bash
npm run electron                      # → .build/electron        300M   (Electron 43.6.0)
npm run download-builtin-extensions   # → .build/builtInExtensions 6.1M
```

实测两者均 **EXIT=0，耗时各约 1 min**。

**失败模式记录（验收 8 第三处）**：

- **Electron 下载**：*本机未复现失败*。失败形态：Electron 二进制从微软 Azure Artifacts universal feed（`@vscode/gulp-electron` / `build/lib/azureFeed.ts` 驱动）拉取，网络中断/代理拦截时 gulp 步骤以非零退出结束，错误信息含 feed 下载失败的 URL 与 HTTP 状态。解法：直接重跑 `npm run electron`（下载到 `.build/electron`，幂等，已完整的文件不会重复拉取）；公司网络下检查对 `*.blob.core.windows.net` / Azure Artifacts 域名的出口。
- **built-in extensions 拉取**：*本机未复现失败*。两个已知失败形态：
  1. 匿名 GitHub API 限速（拉取 `product.json.builtInExtensions` 列出的 VSIX 时）：HTTP 403 + `API rate limit exceeded` 字样。解法：导出 `GITHUB_TOKEN` 后重跑 `npm run download-builtin-extensions`（上游 CI 即如此；本机单次匿名下载未触发）。
  2. 平台资产缺失（改 target 构建时）：`Built-in extension '<name>' is platform-specific but has no asset for target '<target>'`（`build/lib/builtInExtensions.ts:118` 原文）。解法：核对 `product.json` 的 `platformSpecific` 配置与目标三元组。

built-in extensions **匿名下载成功，无需 `GITHUB_TOKEN`**：
```
[github] ms-vscode.js-debug-companion ✔︎
[github] ms-vscode.vscode-js-profile-table ✔︎
[github] ms-vscode.js-debug ✔︎
```
（CI 上仍建议带 `GITHUB_TOKEN` 以避免 API 限速；本机单次未触发。）

---

## 6. 启动

### 6a. 常规编辑器窗口

```bash
./scripts/code.sh
```

### 6b. Agents 窗口（agent-first 形态，`src/vs/sessions/`）

```bash
./scripts/code.sh --agents
```

`--agents` 定义在 `src/vs/platform/environment/node/argv.ts:111`（`deprecates: ['sessions']`），
处理在 `src/vs/code/electron-main/app.ts:1495` → `windowsMainService.openAgentsWindow(...)`。

### 6c. 推荐：用 launch skill（隔离 profile + 动态端口 + 等 CDP）

```bash
export PATH="$PWD/.build/node24/bin:$PATH"
unset ELECTRON_RUN_AS_NODE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS   # ← 见下方注意事项

./.agents/skills/launch/scripts/launch.sh --session-title "verify-workbench"
./.agents/skills/launch/scripts/launch.sh --agents --session-title "verify-agents"
```

**实测输出**（两次都成功）：

```json
{"pid":21886,"cdpPort":64426,"extHostPort":64427,"mainPort":64428,"agentHostPort":64429,
 "userDataDir":"/tmp/code-oss-dev-…/user-data","runDir":"/tmp/code-oss-dev-…",
 "logFile":"/tmp/code-oss-dev-…/code.log","agents":false,
 "timings":{"profileMs":579,"preLaunchMs":826,"cdpReadyMs":3514,"totalMs":4919}}
```

```json
{"pid":24576,"cdpPort":64701,…,"agents":true,
 "timings":{"profileMs":293,"preLaunchMs":768,"cdpReadyMs":743,"totalMs":1804}}
```

> 时效说明：`cdpReadyMs` 在不同机器/运行之间波动（另一次实测为 699ms / total 1423ms，2026-09-19 D01 复核轮）；以数量级（<5s）为准，不要把单个毫秒数当作回归基线。

必须 unset 的三个环境变量（launch skill 的 Troubleshooting 已记录，实测确认）：
- `ELECTRON_RUN_AS_NODE` → 否则 renderer 报 ESM 错误 / `import { Menu } from 'electron'`
- `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS` → 否则 Git 报 `missing config value GIT_CONFIG_VALUE_*`

### 6d. 验证 Codex provider 注册（**关键**）

Agent Host 有独立日志，不在 `code.log` 里：

```bash
RUN=<launch.sh 输出 JSON 里的 runDir>
cat $RUN/user-data/logs/*/agenthost.log | grep -iE "codex|Registering agent provider"
```

**实测输出（成功标志）**：
```
Registering agent provider: copilotcli
Registering agent provider: claude
Registering agent provider: codex
[Codex] starting one-off startup account probe
[Codex] resolving SDK from repo node_modules (dev fallback): /Users/…/vscode
[CodexProxyService] listening on http://127.0.0.1:64722
[Codex] spawning app-server from /…/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex
[CodexClient warn] dropping unhandled notification: remoteControl/status/changed
[Codex] account/read accountType=chatgpt requiresOpenaiAuth=true planType=plus
[Codex] stopped one-off startup account probe
[AgentService] discovery for provider claude: 140 candidate(s) (140 external), 140 registered
```

要点：
- **三个 provider 全部注册**，Codex 走 dev fallback，**零 env override**
- `accountType=chatgpt planType=plus` → 用的是 **OpenAI 原生认证**（读 `~/.codex/auth.json`），全程无 GitHub token
- account probe 在 **1.1s** 内完成并回收子进程（符合"ambient refresh 不得把启动探测变成长连接"的设计意图）
- `dropping unhandled notification: remoteControl/status/changed` 是**已知未接线能力**，见 [#18 D16](https://github.com/Colin4k1024/vscode/issues/18)

### 6e. 用 CDP 确认页面真实加载

```bash
PW=mysession
npx @playwright/cli -s=$PW attach --cdp=http://127.0.0.1:<cdpPort>
npx @playwright/cli -s=$PW tab-list
```

实测：
- 常规窗口 → `0: (current) [verify-workbench — Code - OSS Dev](…/out/vs/code/electron-browser/workbench/workbench-dev.html)`
- Agents 窗口 → `0: (current) [Agents](…/out/vs/sessions/electron-browser/sessions-dev.html)`

Agents 窗口的 workbench class 实测含 `agent-sessions-workbench`：
```
monaco-enable-motion monaco-workbench agent-sessions-workbench modern-ui-tabs
modern-ui-notifications-dialogs mac chromium nomaineditorarea nopanel
nocustomviewgrid nostatusbar macos-tahoe dock-detail
```

窗口渲染证据截图（CDP `Page.captureScreenshot`，2026-09-19）：[`evidence/D01-agents-window.png`](evidence/D01-agents-window.png) —— Agents 窗口完整渲染：左侧 Sessions 列表 / New / Chats / Customizations / Plugins / MCP Servers / Skills，中央 composer。截图时弹出的对话框是该 profile 上次打开目录的 workspace trust 询问（选信任/浏览均可继续），不是登录墙。GitHub 登录墙的证据截图属于 D04（#6）的范围，届时单独采集。

### 6f. ⚠️ 已知阻断：Agents 窗口的 GitHub 登录墙

**即使 Codex 已能用 ChatGPT 认证正常工作**，Agents 窗口仍会弹出**不可跳过**的登录对话框：

```
[INFO:CONSOLE] "[sessions welcome] Showing sign-in dialog"

标题:  Sign in to use Agents
正文:  By continuing, you agree to GitHub's Terms and Privacy Statement. …
按钮:  [Return to VS Code Editor] [Continue with GitHub] [Continue with Google]
       [Continue with Apple] [Continue with GHE]
       ← 没有 "Don't sign in" / 跳过 / 关闭
```

成因链（全部已定位）：
1. `chat.agentHost.allowSignedOutWhenUsable` 未设置（实测该 profile 的 `User/settings.json` 只有 `{"files.simpleDialog.enable": true}`）
2. → `isAllowSignedOutWhenUsableEnabled()` 返回 false（`src/vs/sessions/browser/sessionsAuthGate.ts`）
3. → `resolveSignedOutWindowGate()` 直接返回 `ForceGitHubSignIn`
4. → 非可关闭模态

**临时绕过**（仅用于本地验证，不是修复）：在该 profile 的 `User/settings.json` 加
```json
{ "chat.agentHost.allowSignedOutWhenUsable": true }
```
正式修复归 [#6 D04](https://github.com/Colin4k1024/vscode/issues/6)（把默认值产品化，**不需要改 `resolveSignedOutWindowGate` 的函数逻辑**——因为 `codexAgent.ts:getProtectedResources()` 已刻意把 copilot resource 标为 `required: false`，`Proceed` 分支会被命中）。

> 值得注意：登录墙**背后**的 session 列表其实已经渲染完成（DOM 里能看到 `Sessions / New / ⌘N / Automations / Chats / <项目名> / <历史 thread 标题> / Customizations / Plugins / MCP Servers 1 / Skills 13`）。
> 说明数据链路完全通，纯粹是模态遮挡。外部 Codex 会话发现（`onDidDiscoverChats`）与 customization 发现（`codexCustomizations.ts`）在真实环境已工作——本机 `~/.codex/sessions` 有 174 个 jsonl、`~/.codex/skills` 有 218 个。

---

## 7. 清理

```bash
# 关窗口
kill <pid>
# 确认无孤儿进程（对齐 01-ACCEPTANCE-CORE.md 的 D16 检查）
pgrep -f "codex app-server"   # → 空
pgrep -f "Code - OSS"         # → 空
# 断开 playwright daemon
npx @playwright/cli -s=<session> close
# 删掉一次性 profile
rm -rf <runDir>
```

实测：关闭窗口后 `codex app-server` 与 `Code - OSS` 进程**均无残留**。

完全回滚本文件所做的一切环境改动：
```bash
rm -rf .build/node24 .build/npm-cache .build/electron .build/builtInExtensions node_modules out
# 全局 node、全局 npm 缓存、~/.codex 均未被触碰
```

---

## 8. 一键脚本

**`bootstrap.sh`**（同目录，可执行）是唯一权威实现；本节只描述其行为，不再内联快照（避免与脚本漂移）。用法：

```bash
bash .agents/research/codex-desktop/bootstrap.sh           # 幂等
bash .agents/research/codex-desktop/bootstrap.sh --force   # 无条件全量重跑
```

脚本语义（与 §1–§5 的手工序列一一对应）：

1. **前置守卫**：`n` 不在 PATH 时打印可读错误并退出（列出 n / fnm / nvm / volta 四个替代项的安装命令）；见 §0 的替代方案说明。
2. **Node**：`n $(cat .nvmrc)` 装进仓库本地前缀 `$N_PREFIX=.build/node24`，全局 node 不动；已装且版本匹配则跳过。
3. **依赖**：守卫为「根 `node_modules/.package-lock.json` 存在 **且** `extensions/copilot/node_modules/@vscode/copilot-api` 存在」——后者是 §3 记录的"postinstall 中途死掉"故障形态的深层标记；根装完但子安装缺失时只重跑 `postinstall.ts`（幂等），不重复整个 `npm ci`。
4. **编译**：守卫为「`out/vs` 存在 **且** `extensions/*/out` 计数 ≥ 8」（实测基线 32；阈值 8 在容忍上游扩展数量波动的同时，能抓住"编到第一个扩展就挂"的半成品树）。
5. **Electron / built-in extensions**：目录已存在则跳过。

CI 侧的等价物是 `.github/workflows/codex-desktop-baseline.yml`，触发器为 **pull_request（main，`**.md` 改动跳过）+ workflow_dispatch（合并到 main 后可用）**，带 concurrency 取消与 node_modules 缓存：`npm ci`(5×重试) → `gulp transpile-client-esbuild transpile-extensions` → `check-clean-git-state.sh` → `codex:check-protocol` → agentHost 单测子集。

---

## 9. 实测汇总

| 项 | 值 |
|---|---|
| 端到端首次 bootstrap 总耗时 | **约 12 min**（install 7 + compile 0.3 + assets 2 + 余量） |
| 磁盘占用 | `node_modules` 1.4G + `.build/electron` 300M + `out` 404M + `.build/npm-cache` ≈ **2.5G** |
| 编译错误 | **0** |
| 启动到 CDP ready | 常规 **3.4s** / Agents **0.6s** |
| Codex provider 注册 | ✅ 零配置 |
| Codex 二进制版本 | **0.153.0**（与 pin 精确一致） |
| 认证 | OpenAI 原生 ChatGPT（`planType=plus`），**无需 GitHub** |
| 孤儿进程 | 无 |
