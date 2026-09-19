# 只读调研：把 Codex 能力集成进 VS Code，做成自有 Coding Desktop App

调研日期：2026-09-19
调研方式：**只读**。未修改任何业务代码，未创建/删除任何 GitHub 对象。

代码基线：

| 仓库 | remote | HEAD | 日期 |
|---|---|---|---|
| `/Users/jiafan/Desktop/poc/vscode` | `git@github.com:Colin4k1024/vscode.git` | `fb20064c0f4` (`code-oss-dev 1.139.0`) | 2026-09-19 |
| `/Users/jiafan/Desktop/poc/codex` | `git@github.com:Colin4k1024/codex.git` | `ac192cd79` | 2026-09-06 |

---

## 0. 结论先行（最重要的一条事实）

**VS Code 这个 fork 里已经存在一套完整、成熟、带 CI 门禁的 Codex 集成。**
"把 Codex 集成进 VS Code" 不是从零开发，而是 **启用 + 去耦 + 品牌化 + 打包 + 验收加固**。

证据：

- `src/vs/platform/agentHost/node/codex/` — 26 个非测试源文件，约 **15,000 行**，其中 `codexAgent.ts` 单文件 **8,427 行**。
- `src/vs/platform/agentHost/node/codex/protocol/generated/` — **828 个**由 `codex app-server generate-ts --experimental` 生成的协议类型文件。
- 生成器与新鲜度门禁：`build/codex/generate-protocol.mjs`、`build/codex/check-protocol-sync.ts`，版本钉在 `build/codex/codex-version.txt` = **0.153.0**，CI 挂在 `.github/workflows/pr.yml:106`。
- 测试资产：30 个 `codex*.test.ts` 单测/集成套件 + **103 个确定性 replay e2e capture**（`test/node/e2e/captures/codex-*.yaml`）+ `codexAgentHostLive.integrationTest.ts`（`AGENT_HOST_REAL_CODEX=1` 门禁）。
- 架构规范：`src/vs/platform/agentHost/AGENTS.md`（603 行），含不变量 **I1–I8**，自述 **Status: COMPLETE (2026-07-01)**。
- `git log -- src/vs/platform/agentHost/node/codex/` → **190 次提交**，最近一次 `b0dad94048b`。

同时，VS Code 已经内置了一个 **agent-first 的独立窗口形态**：`src/vs/sessions/`（`--agents` 启动参数 → `windowsMainService.openAgentsWindow()`，入口 `src/vs/sessions/electron-browser/sessions.html`），带 editor / terminal / files / fileTreeView / search / changes / codeReview / workspace / accountMenu 等 30 个 contrib。**这本身就是一个 coding agent desktop app 的壳。**

所以真实工作量集中在下面 4 件事，而不是"写集成"：

1. 让它在本机 **跑得起来**（仓库当前是裸的）。
2. 让它 **不依赖 GitHub/Copilot** 也能用（当前默认路径是 Copilot 代理）。
3. 让它变成 **你的产品**（品牌、打包、分发、合规）。
4. 让它 **可验收、可回归、可跟随上游**（不变量守卫 + 版本升级 runbook）。

---

## 1. 当前事实

### 1.1 Codex 仓库侧：可用的集成面

`codex-rs/` 是约 130 个 crate 的 Rust workspace。对外集成面有 4 条，能力递减：

| 集成面 | 位置 | 协议 | 能力 | 适配度 |
|---|---|---|---|---|
| **`codex app-server`** | `codex-rs/app-server/`（README 3,025 行） | JSON-RPC 2.0 双向；stdio（默认）/ `ws://` / `unix://` | 全量：thread/turn/item、审批、elicitation、MCP、skills、hooks、plugins、apps、auth、rate limits | ★★★ 官方 VS Code 扩展用的就是它 |
| `codex app-server` 协议导出 | `app-server-protocol/` | `generate-ts` / `generate-json-schema`，`--experimental` 开关 | 版本自证的 TS 类型 / JSON Schema | ★★★ VS Code 已 vendored |
| `@openai/codex-sdk` (TS) | `sdk/typescript/` | 包装 `codex exec`，stdin/stdout JSONL | 无审批、无 elicitation、无双向请求 | ★ 不适合做 IDE |
| `codex-mcp` / `exec` | `codex-rs/codex-mcp/`、`codex-rs/exec/` | MCP / 一次性 CLI | 工具化、headless | ☆ 备选 |

核心原语（app-server README §Core Primitives）：

- **Thread** = 一次会话（含多个 turn），可 `thread/start` / `thread/resume` / `thread/fork`，支持 `ephemeral`
- **Turn** = 一轮对话，`turn/start` → `turn/started` → 事件流 → `turn/completed`；可 `turn/interrupt`、`turn/steer`
- **Item** = 用户输入 / agent 输出 / 命令执行 / 文件改动，**持久化**并作为后续上下文

认证模式（`account/login/start` 的 `type`）：`chatgpt`（浏览器 OAuth，app-server 自己起本地回调）、`chatgptDeviceCode`、`apiKey`、`amazonBedrock`、`amazonBedrockAccessKeys`、`personalAccessToken`（走 `codex login --with-access-token` / `CODEX_ACCESS_TOKEN`，不经 app-server RPC）。

审批/交互请求（server → client，**必须响应否则 turn 挂住**）：
`item/commandExecution/requestApproval`（含 `kind: command | writeStdin`）、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/tool/call`（dynamic tools）、`attestation/generate`、`currentTime/read`。
每个都以 `serverRequest/resolved {threadId, requestId}` 收尾——**包括 turn 开始/完成/中断导致的清理**。这是恢复语义的关键锚点。

沙箱与策略：`linux-sandbox`/`bwrap`、macOS Seatbelt、`windows-sandbox-rs`、`execpolicy`、permission profiles（`:workspace` / `:read-only` / `:danger-full-access`）、Guardian / `approvals_reviewer = "auto_review"`。

背压：入队饱和时返回 JSON-RPC **`-32001` "Server overloaded; retry later."**，客户端需指数退避 + jitter。

本机现状：`/opt/homebrew/bin/codex` → **`codex-cli 0.155.1`**；`cargo 1.97.1` / `rustc 1.97.1` 可用（能从源码构建 `/poc/codex`）。

`/poc/codex` 上已有 **29 个 issue（#1–#29，label `harness`）**，属于**另一个项目**：在 `codex-rs/harness` + `harness-runtime` 里做一个 Rust 工作流运行时（引用 `HARNESS_IMPLEMENTATION_TASKS.md` / `HARNESS_INTEGRATION_DESIGN.md` / `harness-demo@4c0f51f8`）。见 §5 去重结论。

### 1.2 VS Code 仓库侧：已有集成的具体形态

**进程拓扑**

```
Renderer (workbench 或 Agents 窗口)
   │  AHP 协议 (JSON-RPC over WebSocket / IPC MessagePort)
   ▼
Agent Host 进程  (src/vs/platform/agentHost/node/, utility process)
   │  AgentService → IAgentHostProviderService → IAgent
   ├── CopilotAgent  (node/copilot/)
   ├── ClaudeAgent   (node/claude/)
   └── CodexAgent    (node/codex/)  ──stdio JSON-RPC──▶ `codex app-server` 子进程
                                        ▲
                          codexProxyService: 本地 loopback HTTP
                          OpenAI Responses → GitHub Copilot CAPI
                          (Bearer <nonce>，token 可热轮换)
```

**两条模型通路**（`codexAgent.ts:246-248`）

| 常量 | 值 | 语义 |
|---|---|---|
| `CODEX_COPILOT_MODEL_PROVIDER` | `'vscode-proxy'` | 走 loopback 代理 → Copilot CAPI，需 GitHub token |
| `CODEX_OPENAI_MODEL_PROVIDER` | `'openai'` | 走 Codex 原生 ChatGPT 订阅认证，**不需要 GitHub** |

启动配置由 `codexLaunchConfig.ts:buildCodexLaunchConfig()` 生成，把 `model_providers.vscode-proxy.*` 作为 `-c` 覆盖注入，并设 `env.OPENAI_API_KEY = proxy.nonce`；同时注入 `codexPermissionProfileOverrides()`（`vscode-workspace` / `-network` / `-read-only` 三个 profile）与 `codexTelemetryOverrides()`（**强制 `analytics.enabled=false`、`feedback.enabled=false`**，OTel exporter 默认 `none`）。

`initialize` 握手（`codexAgent.ts:2539-2542`）：

```ts
clientInfo: CLIENT_INFO,
capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null }
```

即：**已开实验 API**，**未接 attestation**。

**已实现的 Codex 能力清单**（按文件）

| 文件 | 行数 | 覆盖 |
|---|---|---|
| `codexAgent.ts` | 8427 | IAgent 全量实现：连接管理、chat/thread 绑定、model catalog、账号、审批路由、server tools、fork/side-chat/peer chat、worktree、checkpoint、迁移 |
| `codexMapAppServerEvents.ts` | 1294 | app-server 通知 → AHP `AgentSignal` 映射（agentMessage/reasoning/commandExecution/fileChange/mcpToolCall/tokenUsage/turn 生命周期） |
| `codexProxyService.ts` | 545 | loopback Responses→CAPI 代理、nonce、portable-history header、SSE 心跳（15s 阈值） |
| `codexAppServerClient.ts` | 481 | JSON-RPC 客户端、`JsonRpcError`、`transportFromChildProcess`、server-request handler |
| `codexMcpServers.ts` | 435 | MCP 清单、OAuth token 注入、启动状态翻译 |
| `codexCustomizations.ts` | 434 | workspace agents / instructions / skills / hooks 发现 |
| `codexReplayMapper.ts` | 420 | `thread/turns/list` → Turn[] 确定性重放（side-chat / restore 用） |
| `codexClientCustomizations.ts` | 384 | 客户端插件 → codex config/skill roots |
| `codexProfileImage.ts` | 363 | ChatGPT 头像，1MiB 上限，nonce 校验的 `vscode-codex-profile-image:` URI |
| 其余 16 个文件 | ~1400 | 会话元数据存储、Guardian 自动审查、prompt 解析、thread 列表分页、fork 计划、elicitation 映射、用户输入映射、shell 命令解包、rollout 元数据、账号状态、delegation、folder picker、provider 配置/切换遥测 |

**Agents 窗口（`src/vs/sessions/`）**：`sessions.html` / `sessions.main.ts` / `workbench.ts` / `singlePaneWorkbench.ts`；contrib 含 `editor`、`terminal`、`files`、`fileTreeView`、`search`、`changes`、`codeReview`、`workspace`、`accountMenu`、`automations`、`aquarium`、`onboardingTours`、`providers/agentHost`。已有 web 变体（`scripts/code-sessions-web.sh`）。

**启用门禁**（全部已定位）

| 开关 | 位置 | 默认值 | OSS 构建下的实际值 |
|---|---|---|---|
| `chat.agentHost.codexAgent.enabled` | `agentHostStarter.config.contribution.ts:293` | `product.quality !== 'stable'` | **true**（`product.json` 无 `quality` 字段） |
| `chat.editor.codex.preferAgentHost` | `chat.shared.contribution.ts:1026` | `product.quality !== 'stable'` | **true** |
| Agent Host 内注册 Codex provider | `agentHostMain.ts:175-190` | `!environmentService.isBuilt \|\| agentSdkDownloader.isAvailable(CodexSdkPackage)` | dev 下 **恒真**；built 下取决于 `product.agentSdks.codex` |
| 注册是**单向**的（register-on-enable） | 同上 | 关闭需重启 Agent Host | — |
| 策略 `Codex3PIntegration`（minVersion 1.126） | `agentHostStarter.config.contribution.ts:307` | `thirdPartyAgentEnabledValue` | 可被托管策略硬关 |
| `chat.agentHost.allowSignedOutWhenUsable` | `agentService.ts:175` | 实验性 opt-in | **需显式打开**，否则 Agents 窗口强制 GitHub 登录 |
| `chat.agentHost.codexAgent.sdkRoot` | `agentService.ts:339` | `''`，`included: product.quality !== 'stable'` | dev override 入口 |
| `chat.agentHost.codexAgent.codexHome` / `.binaryArgs` | 同上 | `''` / `[]` | 调试入口 |

对应环境变量：`VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED`、`VSCODE_AGENT_HOST_CODEX_SDK_ROOT`、`VSCODE_AGENT_HOST_CODEX_HOME`、`VSCODE_AGENT_HOST_CODEX_BINARY_ARGS`。

**Codex 二进制的三级解析**（`codexAgent.ts:_resolveSdkRoot` / `_startRawConnection:2468-2483`）

1. `IAgentSdkDownloader.isAvailable(CodexSdkPackage)` → 环境变量 override 或 `product.agentSdks.codex` 下载
2. dev fallback：`resolveCodexDevSdkRoot()`（`codexAgent.ts:8407`）从本仓库 `node_modules/@openai/codex/package.json` 反推仓库根
3. 都没有 → 交给 downloader 抛出可诊断错误

最终执行路径硬编码为：
`<root>/node_modules/@openai/codex-<platform>-<arch>/vendor/<rust-triple>/bin/codex[.exe]`，并 `fs.accessSync(X_OK)` 校验。

根 `package.json` devDependencies 已含 **`@openai/codex 0.153.0`**（以及 `@anthropic-ai/claude-agent-sdk 0.3.258`）。→ **只要 `npm install` 成功，dev 路径就能直接跑 Codex，不需要任何 env override。**

**打包侧**：`build/agent-sdk/`（`common.ts` / `package.ts` / `upload.ts` / `produce.ts` / `agents/codex/package.json`）。产物是 `npm ci --ignore-scripts --omit=peer` 后的整个 `node_modules` tarball，上传到 `main.vscode-cdn.net`（内容寻址、HEAD-then-decide 幂等），再由 gulp `packageTask` 的 `jsonEditor` 回调把 `agentSdks` 盖进 `product.json`。

### 1.3 环境现状（阻断项）

```
node_modules/   不存在
out/            不存在
.build/         不存在
```

- `.nvmrc` = **24.18.0**；本机 `node -v` = **v22.22.2**。`build/npm/preinstall.ts:13-35` 会 **硬失败**（major 必须一致）。
- `gh` 已认证为 `Colin4k1024`，scopes 含 `repo` / `workflow` → 有能力创建 issue（**本次未执行**）。

---

## 2. 缺口（Gaps）

编号供 Issue 引用。

| ID | 缺口 | 证据 | 影响 |
|---|---|---|---|
| **G1** | 仓库未 bootstrap；Node 22 ≠ 要求的 24 | `node_modules`/`out` 缺失；`.nvmrc`=24.18.0；`preinstall.ts:35` | 一切验证的前置阻断 |
| **G2** | 出厂构建没有 Codex 二进制来源 | `product.json` 无 `agentSdks`；CDN 模板指向 `main.vscode-cdn.net`（Microsoft 所有） | 打包出的 app 里 Codex provider **不会注册**（`agentHostMain.ts:175` 的 `isBuilt` 分支） |
| **G3** | 版本偏斜：pin 0.153.0 vs 本机 codex 0.155.1 vs `/poc/codex` main | `build/codex/codex-version.txt`；`generate-protocol.mjs` 版本校验 | `codex:gen-protocol` / CI `check-protocol-sync` 失败；协议类型与真实二进制不一致 |
| **G4** | **API Key 认证被判为不可用** | `codexAccountState.ts:codexAccountStateFromResponse`：`account.type === 'apiKey'` → `status: 'unavailable'` | 只用 OpenAI API Key（无 ChatGPT 订阅）的用户拿不到 Codex 模型目录 |
| **G5** | 默认/回退 provider 是 Copilot 代理 | `codexAgent.ts:1710`：`model ?? CODEX_COPILOT_MODEL_PROVIDER`；`_ensureModelProviderAuthenticated` 无 token 即抛 `AHP_AUTH_REQUIRED` | 没有 GitHub token 时，未显式选模型 → 直接要求认证 |
| **G6** | GitHub 资源恒被声明；Agents 窗口默认强制 GitHub 登录 | `codexAgent.ts:1517-1528` `getProtectedResources()` 总列 copilot+repo；`sessionsAuthGate.ts:resolveSignedOutWindowGate` 未开 opt-in 即 `ForceGitHubSignIn` | 独立 app 的首启体验被 GitHub 登录墙挡住 |
| **G7** | GitHub 专属能力无开关即失效路径 | `_builtInGitHubMcpServer` 依赖 `_githubToken`；server tools 含 `addcomment`/`resolvecomments`/PR 创建 | 无 GitHub 时相关工具/捕获场景行为未定义 |
| **G8** | 产品身份仍是 Code-OSS | `product.json`：`nameShort/nameLong/applicationName=code-oss`、`dataFolderName=.vscode-oss`、`urlProtocol=code-oss`、`darwinBundleIdentifier=com.visualstudio.code.oss`、`win32*AppId` | 无法作为独立产品安装/共存/深链 |
| **G9** | 无扩展市场 | `product.json` 无 `extensionsGallery`；`sessionsWindowAllowedExtensions: []` | 出厂 app 装不了扩展 |
| **G10** | 默认聊天代理与遥测仍指向 Microsoft/GitHub | `product.json.defaultChatAgent.extensionId = GitHub.copilot`；`agentsTelemetryAppName`；`webviewContentExternalBaseUrlTemplate` → `vscode-cdn.net`；`builtInExtensions` 从 MS repo 拉取 | 数据出口与依赖仍在第三方；隐私声明不成立 |
| **G11** | 未接线的 Codex 能力 | `codexAgent.ts` 目录内 grep 无 `realtime`/`voice`/`cloudTask`/`memories`/`codeMode`；`requestAttestation: false` | 语音、云任务、Apps/Connectors UI、memories、code-mode、attestation 全部不可用 |
| **G12** | 缺"自有 app"的 ADR / 决策记录 / issue 跟踪 | `Colin4k1024/vscode` **0 个 issue**，只有 10 个默认 label；两仓库均无 ADR 目录 | 无验收基线，无归属 |
| **G13** | 合规裁定缺失 | 源码 MIT，但产品名/图标/Marketplace/Copilot 非 MIT；`@openai/codex` Apache-2.0（含商标条款）；`extensions/copilot` 依赖 `@github/copilot`、`@vscode/copilot-api` | 再分发存在法律风险，未评估 |
| **G14** | 验收缺口：不变量无守卫测试 | `AGENTS.md` I1–I8 是**文档**，非可执行断言；`-32001` 背压、连接替换（`CodexConnectionReplacedError`）、`serverRequest/resolved` 清理路径未见专项负向用例 | 回归只能靠人工 |
| **G15** | 上游跟随策略缺失 | fork 于 microsoft/vscode main，165,607 commits；codex pin 需与 828 个生成文件同步 | 无法安全升级 |

---

## 3. 风险（Risks）

| ID | 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|---|
| **R1** | **法律/商标**：以 VS Code 之名或带 Copilot 扩展再分发 | 中 | 致命（下架/诉讼） | D10 前置裁定；剥离 `extensions/copilot`、改名改图标、去掉 MS 遥测与 gallery；参考 VSCodium 模式 |
| **R2** | **上游漂移**：microsoft/vscode 每周大量 agentHost 改动，自有 fork 迅速落后 | 高 | 高 | D14：只做**薄覆盖层**（product.json mixin + 少量 patch），不改 agentHost 核心；固定 rebase 节奏 |
| **R3** | **协议偏斜**：codex app-server 协议在 0.153→0.155 间变更，828 个生成文件与真实二进制不匹配 | 高 | 高 | D02：升级必须"pin + 重新生成 + 全量 replay e2e"三件套原子提交 |
| **R4** | **OpenAI 服务条款**：把 ChatGPT 订阅额度用在自研客户端；`clientInfo.name` 被用于 OpenAI Compliance Logs Platform | 中 | 高 | app-server README 明确要求：企业用途的新集成需联系 OpenAI 加入 known clients 列表。D10 需覆盖 |
| **R5** | **二进制分发体积与许可**：codex 各平台 tarball（Linux musl 静态、macOS arm64/x64、Windows msvc） | 中 | 中 | D09：自托管 CDN + sha256 校验；沿用 `build/agent-sdk` 的内容寻址幂等上传 |
| **R6** | **认证回退黑洞**：G4+G5+G6 叠加 → 用户装了 app 却完全无法开始 | 高 | 高 | D03/D04/D05 必须一起验收（"零 GitHub、仅 API Key" 的冷启动路径） |
| **R7** | **审批挂死**：任一 server→client 请求未响应，turn 永久阻塞 | 中 | 高 | D12/D13：把 `serverRequest/resolved` 作为不变量断言；崩溃恢复必须清理 pending |
| **R8** | **背压雪崩**：忽略 `-32001` 导致重试风暴 | 低 | 中 | D13：负向用例 + 指数退避 jitter 断言 |
| **R9** | **沙箱逃逸/权限放大**：`vscode-workspace` profile 与用户 `~/.codex/config.toml` 合并语义 | 中 | 高 | D05：显式验收"用户配置不得放宽 VS Code 注入的 profile" |
| **R10** | **Agents 窗口不是完整 IDE**：`sessionsWindowAllowedExtensions: []`，扩展生态受限 | 中 | 中 | D07 明确形态取舍；D15 决定 gallery |
| **R11** | **构建成本**：全量 `npm run compile` + 打包在本地耗时/易失败（Node 版本、electron 下载、built-in extensions 拉取） | 高 | 中 | D01 先固化可复现 bootstrap；CI 化 |
| **R12** | **`quality` 字段副作用**：设 `quality: 'stable'` 会让 Codex 默认**关闭**（`product.quality !== 'stable'`） | 中 | 中 | D06：品牌化时必须显式设 `chat.agentHost.codexAgent.enabled` 默认值，不能依赖 quality 推导 |

---

## 4. 关键依赖（Dependencies）

**外部**

| 依赖 | 用途 | 归属 | 阻断级别 |
|---|---|---|---|
| Node.js **24.18.0** | 构建（`.nvmrc` + `preinstall.ts` 强校验） | nodejs.org | 硬阻断 |
| npm < 13 | `preinstall.ts:50` | — | 硬阻断 |
| `@openai/codex` **0.153.0**（+ 平台包 `@openai/codex-<target>`） | 运行时二进制 & 协议生成 | npm | 硬阻断（dev 路径） |
| `@anthropic-ai/claude-agent-sdk` 0.3.258 | Claude provider（同在 devDeps） | npm | 软（可禁用 Claude） |
| Electron 二进制 | `npm run electron` / `build/lib/electron.ts` | MS feed | 硬阻断 |
| `builtInExtensions`（js-debug 等） | `product.json.builtInExtensions` → MS repo | GitHub | 硬阻断 |
| `extensions/copilot` 依赖（`@github/copilot`、`@vscode/copilot-api`、`@vscode/prompt-tsx`） | `npm run compile-copilot` | GitHub Packages / npm | 硬阻断（除非剥离） |
| OpenAI 后端（ChatGPT OAuth / Responses API） | Codex 实际推理 | OpenAI | 运行时 |
| GitHub Copilot CAPI | `vscode-proxy` 通路 | GitHub | 可选（D04 后可不依赖） |
| 自托管 CDN / 对象存储 | 出厂 Codex tarball 分发（G2） | 自建 | 打包阶段阻断 |
| 代码签名证书 + Apple 公证账号 | macOS/Windows 分发 | 自建 | 发布阶段阻断 |

**内部（仓库内依赖顺序）**

```
D01 (bootstrap) ──┬─▶ D02 (二进制供给/版本锁) ──▶ D03 (OpenAI 认证) ──┐
                  │                                                  ├─▶ D05 (默认策略)
                  └─▶ D04 (去 GitHub 耦合) ───────────────────────────┘
                                        │
D06 (品牌) ◀── 独立 ────────────────────┤
D07 (Agents 默认入口) ◀── D04           │
D08 (Copilot/遥测隔离) ◀── 独立          │
                                        ▼
D09 (打包流水线) ◀── D02 + D06 + D08
D10 (合规裁定) ◀── 独立，但**门禁** D06/D08/D09 的发布
D11/D12/D13 (验收矩阵/不变量/负向) ◀── D01 + D02
D14 (上游同步 runbook) ◀── D02 + D11
D15 (扩展市场) ◀── D09
D16 (未接线能力评估) ◀── D03 + D05
```

---

## 5. 已有 Issue 去重结论（提交前检查）

**检查命令与结果**（只读）：

```
gh issue list -R Colin4k1024/vscode --state all --limit 50   →  空（0 个 issue）
gh issue list -R Colin4k1024/codex  --state all --limit 100  →  #1–#29，全部 label `harness`
gh label list -R Colin4k1024/vscode                          →  仅 10 个 GitHub 默认 label
gh label list -R Colin4k1024/codex                           →  默认 10 个 + harness / P0 / P1 / P2
```

**`Colin4k1024/codex` #1–#29 的性质判定**：

这 29 个 issue 由 `HARNESS_IMPLEMENTATION_TASKS.md` 拆分而来，目标是**在 codex-rs 内新建 `harness` / `harness-runtime` crate**，做一个多角色工作流 CLI 运行时（bundle manifest、DAG 调度器、VerificationExecutor、artifact 交接、崩溃对账）。基线是 `harness-demo@4c0f51f8` + `Codex@ac192cd`。

→ **与本次"VS Code 桌面 App 集成"不是同一个项目，不构成重复。** 但有 6 个在 **app-server 协议语义验证** 上高度相邻，应当**交叉引用而非重开**：

| 已有 issue | 相邻内容 | 本次对应 |
|---|---|---|
| **#1 H01** 验证进程内会话客户端 | `thread/start → turn/start → notifications → terminal turn`；审批/用户输入/断连/shutdown 的处理位置 | D02、D12（同一协议契约，不同宿主语言） |
| **#2 H02** 验证 gate 权限与平台限制 | read-only/workspace/admin 限制；**"进程在运行但状态已 cancelled" 不得出现**；Windows 有界停止 | D05、D13（同一条不变量） |
| **#3 H03** 验证恢复与事件处理契约 | 重连后事件缺口；`uncertain` 定义；**不能把 JSON-RPC request ID 当持久化幂等键**；独立 event pump | D12、D13（直接复用其结论） |
| **#19 H19** 崩溃对账与 resume | lease/generation、`running` attempt 复查、无证据即 `uncertain` | D13 |
| **#20 H20** 等待输入的可恢复闭环 | 澄清 vs 权限批准两类请求不可互替；答案是数据不是配置 | D12、D13 |
| **#21 H21** cancel / Ctrl-C / 退出清理 | `cancelling → cancelled` 可观察；不得只 kill worker 就假设工具已退出 | D13 |

**提交建议**（待授权）：

- 目标仓库：**`Colin4k1024/vscode`**（工作目录所在、代码变更落地处、当前 0 issue，无冲突）。
- 新建 label：`codex-desktop`（Epic/总纲）、`P0`/`P1`/`P2`（沿用 codex 仓库已有配色，便于跨仓库对齐）、`area:agentHost`、`area:packaging`、`area:auth`、`area:quality`。
- 每张 issue 用 `Related:` 段显式链接 `Colin4k1024/codex#1/#2/#3/#19/#20/#21`，避免重复劳动。
- **不**在 `Colin4k1024/codex` 开新 issue：本次不改 codex 仓库业务代码（若 D02 发现协议缺口需上游改动，再单独提，且需另行授权）。

---

## 6. 建议的目标 / 范围 / 非目标（待你确认）

> 以下是我基于调研给出的**建议**边界，用于填充你模板里的 `[业务目标]` 等占位符。请确认或修改。

**目标**
产出一个**自有品牌、可独立安装、以 Codex 为默认 agent** 的桌面编码应用，形态基于 VS Code 的 **Agents 窗口**（`src/vs/sessions/`）+ 常规编辑器窗口，认证走 **OpenAI 原生（ChatGPT 订阅 / API Key）**，**不依赖 GitHub 登录即可完整使用**，且具备可回归的验收矩阵与可跟随上游的薄覆盖层。

**范围**
- 仓库 bootstrap 与可复现构建/启动（含 `--agents`）
- Codex 二进制的出厂供给与版本锁（自托管分发，替代 `main.vscode-cdn.net`）
- OpenAI 原生认证一等化（修 G4）、去 GitHub 强制耦合（修 G5/G6/G7）
- 产品身份与品牌（`product.json`、图标、URL protocol、数据目录、bundle id）
- Copilot 默认代理与第三方遥测出口的隔离/关闭
- 打包流水线（`build/agent-sdk` 自托管化 + gulp 平台包）
- 验收加固：确定性 replay e2e 扩展、I1–I8 不变量守卫、崩溃/并发/背压负向用例
- 合规裁定（MIT 源码 vs 商标 vs Apache-2.0 codex vs Copilot 扩展）
- 上游同步 runbook + CI 门禁

**非目标（明确不做）**
- **不重写** `src/vs/platform/agentHost/node/codex/` 已有集成（它已 COMPLETE 且有 103 个 replay 覆盖）
- **不改** `/poc/codex` 的 Rust 业务代码（协议缺口另案，需单独授权）
- **不做** Codex 侧的 harness 工作流运行时（那是 `Colin4k1024/codex#1–#29` 的范畴）
- **不做** 自动更新服务 / 增量差分更新（首版只做静态安装包）
- **不做** Web 版 / 服务端多租户 / 远程 agent host 集群
- **不接** 语音 realtime、cloud tasks、Apps/Connectors UI、memories、code-mode、attestation（D16 仅**评估**，不实现）
- **不做** 自建扩展市场的服务端（只对接现成 gallery，如 Open VSX）
- **不追求** 与 microsoft/vscode 的 100% 行为一致（保留薄覆盖层差异）

**约束**
- 兼容性：`code-oss-dev 1.139.0` 基线；codex app-server 协议 pin **0.153.0**（升级须原子）
- 平台：首版 **macOS arm64**（本机）→ 再 darwin-x64 / linux-x64 / linux-arm64 / win32-x64；不做 armhf / web
- 安全：不放宽 VS Code 注入的 `vscode-workspace*` permission profile；用户 `~/.codex/config.toml` 不得提权；沙箱默认开启；`analytics.enabled=false` / `feedback.enabled=false` 保持
- 交付：D01–D05 + D11–D13 为 MVP 放行门；D06/D09/D10 为发布门
- 许可：分发前必须完成 D10 裁定

---

## 7. 先验资产盘点与战略裁定（**必读**，影响 D06/D07/D09）

调研中发现你在 GitHub 上已有 **三条并行的技术路线**，本次方案必须与它们对齐，否则会产生第四套重复资产。

| 仓库 | 路线 | 与 Codex 的接法 | 状态 | 关键事实 |
|---|---|---|---|---|
| **`Colin4k1024/vscode`**（本仓库） | 上游 VS Code fork | **原生 in-tree**：`src/vs/platform/agentHost/node/codex/`，直接 spawn `codex app-server` 走 stdio JSON-RPC | HEAD `fb20064c0f4`（1.139.0），**0 issue** | 26 文件 / ~15k LOC / 828 生成类型 / 103 replay capture / 190 次提交 / AGENTS.md 自述 COMPLETE |
| **`Colin4k1024/grok-build`** | **从零自建** Electron + Vite + React + Tailwind 桌面 app（含 Rust crates） | **ACP 协议**（`electron/acp-session.ts`） | HEAD `4d7eec40`，活跃；`ISSUES.md` 是完整的 "Codex Desktop 1:1 复刻" 差距分析；160 个 issue（多数已关闭） | 有 `electron/{main,auth,detach,fs-bridge,git-review,claude-import}.ts`、`dist-electron`、`release`、`AUDIT.md`、`THIRD-PARTY-NOTICES` |
| **`Colin4k1024/grok-code-product`** | **Code OSS 瘦发行版**构建系统（Shell） | 打包期 bundle 内置扩展 + agent sidecar | `VERSION` = 0.1.0，`UPSTREAM_COMMIT` = `138f619c86f1199955d53b4166bef66ef252935c`，最后推送 2026-08-12，**0 issue** | 已有 `scripts/{fetch-upstream,apply-patches,build,package,bundle-agent,generate-icons,generate-sbom,check-update,sync-upstream,verify-beta-gates}.sh`、`product/{product.json,branding,default-settings.json,extensions.json}`、`docs/{getting-started,enterprise}.md`、`patches/`（Beta 上限 5 个） |
| `Colin4k1024/grok-code-extension` | VS Code 内置扩展 | ACP | 最后推送 2026-08-12，0 issue | TypeScript，`src/` + `tests/` + `resources/` |
| `Colin4k1024/codex` | 上游 codex fork | 计划在 `codex-rs/harness` 新建工作流运行时 | 29 个 open issue（H01–H29，label `harness`） | 与本 Epic **不同项目** |

### 7.1 三条路线的能力对比（实测源码得出）

| 维度 | 本仓库 agentHost（原生） | grok-build（自建 Electron） | grok-code-product（瘦发行 + ACP 扩展） |
|---|---|---|---|
| 与 Codex 的协议深度 | **app-server 全量**：审批 7 类、elicitation、MCP、skills、hooks、plugins、fork/side-chat/peer chat、worktree、checkpoint、rollout 恢复、rate limits、Guardian auto-review、server tools | ACP（较薄） | ACP（较薄） |
| 编辑器能力 | **完整 VS Code workbench**（Monaco、LSP、debug、terminal、SCM、100+ 内置扩展） | 自建（`fs-bridge` / `git-review`），远不及 | 完整 VS Code |
| 既有测试资产 | **103 replay capture + 30 单测套件 + live 套件 + CI 门禁** | 有 `__tests__`，量级小得多 | 无 |
| 上游维护 | microsoft/vscode 每周推进 agentHost（近期 `b0dad94048b`/`4df534bb7cb`/`8324aca6303`/`b376c21d3e4`） | **全部自己维护** | 上游维护，但 ACP 层自己维护 |
| UX 与 Codex App Desktop 的对齐度 | VS Code 的 Agents 窗口（`src/vs/sessions/`）是**另一种**范式（session 列表 + 单窗格 workbench） | **1:1 复刻**（ISS-057 已完成交互基准调研：三栏、composer 内聚、无浏览器 tab、Projects→threads 树、⌘G 搜索、五 tab 右栏） | 继承 VS Code |
| 品牌/打包成熟度 | 需自建（本 Epic D06/D09） | 已有 `release/`、`build/`、`THIRD-PARTY-NOTICES`、`AUDIT.md` | **已有完整瘦发行流水线**（含 SBOM、图标生成、签名、更新检查、beta 门禁校验） |
| 补丁面 | 若走 mixin 覆盖层 → **接近 0 patch** | N/A | 设计上限 5 patch |
| 法律面 | MIT 源码 + 需处理品牌/Copilot（D10） | 自有 app，法律面最干净 | MIT 源码 + 品牌 |

### 7.2 战略裁定（建议，**待你确认**）

**推荐：以「本仓库 agentHost」为产品内核 + 复用「grok-code-product」的瘦发行流水线 + 借鉴「grok-build ISS-057」的 Codex App Desktop 交互基准作为 UX 目标。**

理由：

1. **协议深度不可复现**：agentHost 的 Codex 集成用的是 `codex app-server` 全量双向协议（7 类审批 + elicitation + dynamic tools + `serverRequest/resolved` 清理语义），ACP 路线做不到同等保真度。自建重写 = 放弃 15k LOC + 103 个 replay capture + 190 次上游提交的沉淀。
2. **补丁面接近零**：`grok-code-product` 的设计上限是 5 个 patch，因为它需要塞进一个 ACP 扩展。而 Codex 集成**已在上游 in-tree**，瘦发行只需要 `product.json` mixin + `agentSdks` 自托管 → **0 patch**，rebase 成本远低于 grok-code-product 当前方案（对齐 R2）。
3. **流水线可直接搬**：`grok-code-product/scripts/` 的 `fetch-upstream` / `apply-patches` / `generate-icons` / `generate-sbom` / `check-update` / `sync-upstream` / `verify-beta-gates` / `bundle-agent` 是成熟资产。D09 应当**移植而非重写**（`bundle-agent.sh` → 改成 `bundle-codex-sdk.sh` 调 `build/agent-sdk/package.ts`）。
4. **UX 目标已有基准**：`grok-build` 的 ISS-057 已把 Codex App Desktop 的交互拆解到控件级（composer 内聚项目/工作模式/分支/模型+effort/审批/add-file；无浏览器 tab；Projects→threads 树；⌘N/⌘K/⌘B/⌘J/⌘O/⌘G/⌘⇧[/] 快捷键；右侧五 tab）。D07 直接以此为验收基准，而不是重新调研。
5. **法律面**：`grok-build` 是自有 app，法律最干净但功能最薄；本路线是 MIT 源码 + 品牌替换，法律面由 D10 覆盖，与 grok-code-product 已趟过的路径一致。

**grok-build 的定位建议**：不废弃，转为**UX 参考实现与快速原型场**。它的 ISS-057 交互基准、`AUDIT.md`、`THIRD-PARTY-NOTICES`、`electron/{auth,detach,git-review}` 的模式可以直接搬进 D07/D10。若最终裁定"VS Code 的 Agents 窗口范式无法满足 Codex App Desktop 的 1:1 体验"，grok-build 是 fallback 路线（届时本 Epic 的 D07 需重开）。

**grok-code-extension（ACP）的定位建议**：本路线下**不需要**。agentHost 是原生 provider，不经扩展宿主，能力与性能都优于 ACP 扩展。建议归档，或保留为"在官方 VS Code 上也能用"的轻量备选。

### 7.3 对 Issue 拆分的影响（已在 `02-ISSUES.md` 落实）

| Issue | 修订 |
|---|---|
| **D06** | 采用 `grok-code-product/product/` 的 mixin 结构（`product.json` + `branding/` + `default-settings.json` + `extensions.json`）；`generate-icons.sh` 直接复用 |
| **D07** | 验收基准改为 `grok-build` ISS-057 的 Codex App Desktop 交互清单（逐项对照 VS Code Agents 窗口的现状，产出差距表）；明确"若差距不可接受则回退 grok-build 路线"的决策门 |
| **D09** | **移植** `grok-code-product/scripts/` 而非重写：`fetch-upstream.sh`、`apply-patches.sh`、`build.sh`、`package.sh`、`generate-sbom.sh`、`check-update.sh`、`sync-upstream.sh`、`verify-beta-gates.sh`；`bundle-agent.sh` 改造为 `bundle-codex-sdk.sh` |
| **D10** | 复用 `grok-build/THIRD-PARTY-NOTICES`、`AUDIT.md` 与 `grok-code-product/docs/enterprise.md` 作为起点 |
| **D14** | 复用 `grok-code-product/UPSTREAM_COMMIT` + `VERSION` + `sync-upstream.sh` 的 pin 机制 |
| **新增 D17** | 见下：路线裁定与资产归并（**建议提到 Wave 1，先于 D06/D07/D09**） |

### 7.4 新增 Issue：D17 [P0] 路线裁定与先验资产归并

因发现三条并行路线，需在投入 D06/D07/D09 之前先做一次显式裁定，避免产生第四套重复资产。

- **目标**：书面裁定产品内核路线（agentHost / grok-build / grok-code-product-ACP），并给出先验资产的「复用 / 移植 / 归档」清单。
- **范围**：§7.1 对比表的实测复核（含在 grok-build 里跑一次 ACP 连接 codex 的可行性验证）；`grok-code-product/scripts/` 逐脚本的可移植性评估；`grok-build` ISS-057 交互基准 vs VS Code Agents 窗口的逐项差距表；资产归属与归档决定。
- **非目标**：不写实现代码；不删除任何仓库（归档需单独授权）；不改 `grok-build` / `grok-code-product` 的代码。
- **依赖**：D01（能在本仓库跑起来才能做实测对比）。**门禁** D06 / D07 / D09。
- **回滚**：纯文档。
- **验收标准**：
  1. `ROUTE-DECISION.md` 存在，含三路线实测对比（不是纸面推断）与明确裁定
  2. 先验资产清单：`grok-code-product` 的 10 个脚本逐个标注「直接复用 / 改造后复用 / 不用」，`grok-build` 的 ISS-057 基准逐项标注「VS Code Agents 窗口已满足 / 部分满足 / 缺失」
  3. 若裁定 agentHost 路线：给出 grok-build 的 fallback 触发条件（哪些 UX 差距不可接受时回退）
  4. 归档决定需你**显式授权**后才执行（本次调研不做任何删除）
  5. D06/D07/D09 的描述被本裁定更新
