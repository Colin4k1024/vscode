# D16 — 未接线 Codex 能力评估（Issue #18 / G11）

- 日期：2026-09-20
- 分支：`codex-desktop/d16-capability-gap`（worktree `vscode-d16`，基线 `origin/main @ d5196680d663`）
- 性质：纯评估，不含实现代码
- 证据来源：
  - VS Code 侧（本仓库）：`src/vs/platform/agentHost/node/codex/**`（`codexAgent.ts`、`codexCustomizations.ts`、`codexClientCustomizations.ts`、`codexProxyService.ts`、`codexLaunchConfig.ts`、`codexGuardianReview.ts`、`codexPromptResolver.ts`）与 vendored 协议 `protocol/generated/**`（生成自 `@openai/codex 0.153.0`）
  - codex 侧：本地 checkout `~/Desktop/gitcode/codex`（`Colin4k1024/codex @ ac192cd79`），含 `codex-rs/app-server/README.md`、`core/src/attestation.rs`、`app-server/src/attestation.rs` 等一手实现
- 证据边界：ChatGPT **后端服务端行为**（是否强制要求 `x-oai-attestation`）不在任何本地仓库内，无法以代码证据证明或排除；相关结论已按下文分层标注。

---

## ⚠️ Attestation 结论（AC2，显著标注，先读）

**结论：`requestAttestation: false` 当前不影响 ChatGPT 后端可用性，不需要开 P0 回灌 D03/D05；但它是一个不可补救的未来政策风险，必须以低成本观测项回灌 D03/D05 的验收矩阵。**

### 机制证据链（全部有代码证据）

1. **VS Code 侧声明不 opt-in**：`codexAgent.ts:2683` — `capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null }`。
2. **协议语义**：`protocol/generated/InitializeCapabilities.ts` — `requestAttestation` 注释为 "Opt into `attestation/generate` requests for upstream `x-oai-attestation`"；`v2/AttestationGenerateParams.ts`（空参）、`v2/AttestationGenerateResponse.ts`（`{ token: string }`，"Opaque client attestation token"）。
3. **app-server 行为**（codex-rs，一手实现）：
   - `app-server/src/thread_state.rs:358 first_attestation_capable_connection_for_thread` — 只在 `request_attestation == true` 的连接中选 attestation 来源；**无 opt-in 连接 → 返回 `None`**。
   - `app-server/src/attestation.rs:45 header_for_request` — connection 为 `None` 时整个 future 产出 `None`（100ms 超时；失败时降级为 `{v:1, s:<code>}` 无 `t` 的信封）。
   - `app-server/README.md:2047`（协议文档原话）："**If no initialized client opted into attestation, app-server omits `x-oai-attestation` for that upstream request.**" —— 省略是协议定义的合法状态，不是错误路径。
4. **核心客户端行为**：`core/src/client.rs:839 generate_attestation_header_for` — `include_attestation == false` 或 provider 返回 `None` 时不加头；`client.rs:658/700/725/1256` — 仅在 Responses / compaction / realtime setup 等 ChatGPT Codex 请求路径附加 `X_OAI_ATTESTATION_HEADER`。
5. **作用范围收窄**：`model-provider/src/provider.rs:392 supports_attestation()` — 仅当 `auth.is_chatgpt_auth()` 时为 true。**API key / 第三方 provider / Copilot CAPI 代理路径（`codexProxyService.ts`）完全不经 attestation**。
6. **其他官方客户端同样不带 attestation**：`codex-rs/exec/src/lib.rs:2064` — "attestation generation is not supported in exec mode"；TUI/CLI 路径不构造 `AttestationProvider`（`core/src/thread_manager.rs:649` 处 `attestation_provider: None`）。这些客户端在 ChatGPT 后端正常工作，是"无 attestation ≠ 不可用"的强旁证。
7. **token 本质**：上游提交 `5f4d0ec34`（`[codex] request desktop attestation from app (#20619)`）明确：token 是 **macOS DeviceCheck 签名 attestation**，生成逻辑在官方 Codex 桌面 app 侧（闭源 PR `openai/openai#878649`），codex-rs 只做转发管道。

### 分层结论

| 层 | 结论 | 证据强度 |
|---|---|---|
| 协议层 | 不 opt-in → 头部被**显式省略**，属合法状态 | 强（README + 实现一致） |
| 当前可用性 | **不受影响**：CLI/TUI/exec 均无 attestation 且正常工作；省略是设计内行为 | 强（旁证） |
| 未来政策风险 | DeviceCheck 是反滥用信号；OpenAI 后端**未来**可对未 attest 客户端限流/拒绝。**无法用本地证据排除** | 不可证（服务端行为） |
| 可补救性 | **不可补救**：合法 DeviceCheck token 只能由 OpenAI 官方签名 app 生成；fork 即便 opt-in 也造不出有效 token，伪造反而可能触发风控 | 强（上游 PR 描述） |

### 处置

- **裁定：不做**（客观上做不了，见"可补救性"）。
- **不开 P0**：当前证据链指向"不影响可用性"；且即便后端政策收紧，本产品侧也无修复手段，P0 issue 无可执行内容。
- **回灌 D03/D05 的观测项（建议，低成本）**：在 D03（OpenAI 原生认证）/ D05（provider 策略）的验收矩阵中加入一条——ChatGPT 路径出现**新形态 401/403/429**（区别于普通 quota）时视为 attestation 政策收紧的早期信号并升级。这只需要在现有错误分类日志中加一个模式，不接 attestation 本身。

---

## 逐项评估（issue 表格全行）

> 裁定口径：**接入 P0-P2**（排期候选，标注触碰文件与 LOC 量级）/ **延后**（有价值但依赖未决）/ **不做**（重复、越界或不可行）。

### 1. Realtime / 语音 — 延后

- **codex 侧**：`codex-rs/realtime-webrtc`、`voice-host`（"Private voice helper foundation"）；协议 `v2/ThreadRealtimeStartParams.ts`（标注 **EXPERIMENTAL**，含 WebRTC SDP 传输 `ThreadRealtimeStartTransport`、语音清单 `ThreadRealtimeListVoices*`、`ThreadRealtimeOutputAudioDeltaNotification` 等 20+ 类型）。
- **VS Code 侧现状**：`node/codex/**` grep（排除 generated）无 `realtime`/`voice` 命中。
- **价值**：桌面 IDE 的语音输入/输出是差异化体验，但 Copilot 已有 voice 入口，且 Codex 协议侧仍 EXPERIMENTAL。
- **代价**：8–15 人日（Electron utility process 内 WebRTC、音频设备权限与 macOS 公证、`codexAgent.ts` 会话生命周期扩展、chat UI 音频渲染）。
- **依赖**：D03（realtime setup 走 ChatGPT auth 路径，且被 attestation 附加逻辑覆盖 `client.rs:1256`）；Electron 媒体栈验证。
- **风险**：协议 EXPERIMENTAL 变更频繁；音频权限与签名公证成本高；voice-host 是私有 helper，分发边界未清。
- **裁定：延后**。协议稳定（去 EXPERIMENTAL 标注）后重评。

### 2. Cloud tasks — 延后

- **codex 侧**：`codex-rs/cloud-tasks{,-client,-mock-client}`（`cloud-tasks/src/lib.rs` 为 TUI 环境过滤数据模型）；协议 `v2/Environment*.ts`（add/info/status 等）。
- **VS Code 侧现状**：无（grep 无 `cloudTask`/`environment/add` 命中）。
- **价值**：暴露 ChatGPT 云端任务；但与 Copilot cloud agent 功能重叠，且本产品定位是本地 agent host。
- **代价**：6–10 人日（环境列表 UI、任务状态轮询、与本地 thread 模型的双轨展示）。
- **依赖**：D03/D05（仅 ChatGPT auth 下有意义）；产品定位决策。
- **风险**：与 Copilot cloud agent 体验冲突；云端任务生命周期与本产品本地状态机（D12 不变量）不兼容。
- **裁定：延后**。等 D05 provider 策略定稿后由产品决定是否进入路线。

### 3. Apps / Connectors — 延后

- **codex 侧**：`codex-rs/connectors`（connector 目录发现、缓存、工具选择）；协议 `v2/AppsListParams.ts`、`AppsReadParams.ts`、`AppsInstalledParams.ts`、`AppListUpdatedNotification.ts`、`AppMetadata.ts`、`AppBranding.ts`。
- **VS Code 侧现状**：仅 `codexGuardianReview.ts:95` 把 `connector_id` 透传进 guardian 审查项；`codexPromptResolver.ts:41` 明示 "Skill / app mentions are deferred to a later phase"。无 `$<app-slug>` mention、无 `appMetadata`/`branding` 渲染。
- **价值**：`$app` mention + connector 工具是 Codex 生态核心体验，长期看价值高。
- **代价**：10–15 人日（mention 输入管道 ≈400 LOC；app list/installed 缓存与 `app/list/updated` 失效 ≈300 LOC；metadata/branding 渲染 UI ≈800–1500 LOC）。
- **依赖**：D03/D05（connector 目录与 ChatGPT 账号绑定）；D06 品牌边界（渲染第三方 branding 的合规审查，关联 D10）。
- **风险**：connector 目录内容面向 ChatGPT 账号体系，自有 app 的适用性未定；UI 面大。
- **裁定：延后**。D03/D05 + D10 定稿后作为独立 feature 立项。

### 4. Memories — 延后

- **codex 侧**：`codex-rs/memories`；协议 `v2/ThreadMemoryModeSetParams.ts`、`MemoryCitation.ts`、`MemoryResetResponse.ts`、根级 `ThreadMemoryMode.ts`。
- **VS Code 侧现状**：无（`codexAgent.ts`/`codexSessionConfigKeys.ts` 无 `memoryMode` 命中）。
- **价值**：跨会话记忆提升长任务连续性；但涉及用户数据留存，隐私边界必须先设计。
- **代价**：4–6 人日（`thread/memoryMode/set` 接线 ≈80 LOC；记忆管理/清除 UI ≈300–500 LOC）。
- **依赖**：D05（记忆默认开关属 provider/权限策略）；隐私合规裁定。
- **风险**：默认开启会造成意外数据留存；与 harness H29（经验候选与晋升）的概念重叠需划界。
- **裁定：延后**。隐私边界设计先行；若 harness H29 落地经验库，本项目 memories UI 优先级进一步降低。

### 5. Code mode — 延后

- **codex 侧**：`codex-rs/code-mode{,-host,-protocol,-runtime}`（`code-mode/src` 含 grpc_session / remote_session）；`--code-mode-host URL`；动态工具 `deferLoading`（`v2/DynamicToolFunctionSpec.ts:11`）。
- **VS Code 侧现状**：`common/agentServerTools.ts:19` 已有 `deferLoading` 字段（AHP 侧声明），但 `node/codex/**` 无 code-mode host 接线。
- **价值**：远程 code-mode host 对企业集中部署有价值；`deferLoading` 可降低大工具集的 schema 开销。
- **代价**：接远程 host 5–8 人日；仅补 `deferLoading` 透传 0.5–1 人日。
- **依赖**：D05；企业部署形态决策。
- **风险**：远程 host 引入新的信任边界（代码执行面外移）。
- **裁定：延后**（远程 host）；`deferLoading` 透传并入第 8 行 dynamic tools 增量。

### 6. Attestation — 不做（见文首显著结论）

- **价值/依赖/风险**：N/A（不接入）；风险即文首所述未来政策收紧，由观测项覆盖。

- **裁定：不做**。合法 DeviceCheck token 只能由 OpenAI 官方签名 app 生成（上游 PR `5f4d0ec34` + 闭源 `openai/openai#878649`），fork 无实现路径；协议允许省略头部。以观测项回灌 D03/D05。

### 7. `currentTime/read` — 接入 P2（防御性）

- **codex 侧**：`app-server/README.md:2049-2051` — `[features.current_time_reminder]` + `clock_source = "external"` 时，app-server 在提醒到期时向订阅 thread 的客户端发 `currentTime/read`（`v2/CurrentTimeReadParams.ts`），客户端回 `{ currentTimeAt }`。
- **VS Code 侧现状**：无任何 `currentTime`/`clock_source` 命中（排除 generated）。
- **价值**：本身是锦上添花的时间提醒；**真正价值在防御**——README 明示 "A failed, canceled, timed-out, or malformed response **stops the turn** before the model request is sent"。当前 launch config（`codexLaunchConfig.ts`）未显式关闭该 feature，一旦 codex 侧默认或用户 config 开启 external clock，未接线的客户端会造成 **turn 级阻断**。
- **代价**：0.5 人日。触碰 `codexAgent.ts`（server-request handler 注册 + 回应当前 Unix 秒，≈50 LOC）。
- **依赖**：无。
- **风险**：极低；回应本机时间与 codex 内部时钟源一致性可忽略。
- **裁定：接入 P2**（防御性，不是功能驱动）。

### 8. Dynamic tools — 已接入（保留增量项）

- **价值**：`deferLoading` 降低大工具集 schema 开销；**依赖**：无；**风险**：低（透传一层，不改时序约束）。

- **codex 侧**：`item/tool/call`（`v2/DynamicToolCallParams.ts`）+ `thread/start.dynamicTools`。
- **VS Code 侧现状**：`codexAgent.ts:947 dynamicToolResponseFromResult`、`:2819 _handleDynamicToolCallRpc`、`:2964 _buildDynamicTools`（"Codex only accepts `dynamicTools` at `thread/start`" 注释说明已处理时序约束）。
- **覆盖度缺口**：`deferLoading`（`v2/DynamicToolFunctionSpec.ts:11`）未从 AHP 侧透传（`agentServerTools.ts:19` 有字段）。
- **裁定：已接入**（本行关闭）；增量 `deferLoading` 透传 0.5–1 人日（`codexAgent.ts` `_buildDynamicTools` ≈20 LOC + 类型），并入第 5 行 code-mode 延后可选项。

### 9. Worktree（codex 侧）— 不做

- **价值/依赖/风险**：N/A（不接入）；风险为零（保留 host 层闭环，避免双重 worktree 冲突）。

- **codex 侧**：`codex-rs/worktree`（`src/lib.rs`："A Desktop-compatible checkout and the cwd that should be used to start its thread"），上游提交 `f6976ab03`（TUI session commands 的 managed worktree 创建）。
- **VS Code 侧现状**：已有 host 层隔离 `IAgentHostWorktreeIsolation` / `IAgentHostWorktreePendingState`（`codexAgent.ts:75/1322/5787`，`../shared/worktreeIsolation.ts`），在 `thread/start` 前完成 cwd 替换。
- **关系**：两者解决同一层问题（session→隔离工作目录）。codex-rs/worktree 面向 TUI/Desktop 会话命令；本产品已在 host 层闭环，再复用会产生双重 worktree（嵌套 cwd）与状态归属冲突。
- **裁定：不做**（保留现有 host 层实现；harness H27 在 CLI 侧做同类编排，亦无需复用 codex crate）。

### 10. Skills 生态 — 已接入（保留增量项）

- **价值**：用户可启停单个 skill；**依赖**：无；**风险**：低（配置写回 + UI 入口）。

- **VS Code 侧现状**（已接线，证据）：
  - `skills/extraRoots/set`：`codexAgent.ts:7680`（client-plugin skills 推送）
  - `skills/changed` 失效信号：`codexAgent.ts:2766` → `_queueSkillHookCustomizationRefresh`
  - `skills/list`（cwd-scoped）：`codexAgent.ts:7635` 注释、`:7721-7731` 与 workspace 发现去重（`codexCustomizations.ts:156 excludeCodexWorkspaceSkillDuplicates`）
- **缺口**：`skills/config/write`（`v2/SkillsConfigWriteParams.ts`）未接——用户无法在 UI 中启停单个 skill。
- **裁定：已接入**（核心闭环完成）；增量 `skills/config/write` 接入 P2，≈1 人日（`codexAgent.ts` ≈40 LOC + session 配置键 + 设置 UI 入口 ≈80 LOC）。

### 11. Hooks — 已接入（保留 UI 增量）

- **价值**：用户可见 hook trust 状态与来源；**依赖**：无；**风险**：低（只读展示 + 既有写回路径）。

- **VS Code 侧现状**（已接线，证据）：
  - `hooks/list`：`codexAgent.ts:7766/7790`（cwd-scoped）
  - trust 状态写回：`codexAgent.ts:7806-7807` — workspace trusted 时经 `config/batchWrite` 写 `{ trusted_hash: hook.currentHash }`（协议 `v2/HookTrustStatus.ts`、`HookMetadata.currentHash`）
  - 容器投影：`codexCustomizations.ts:388 hookToCustomization`（`codex-hooks:` scheme）
- **缺口**：`HookTrustStatus` 未在 UI 暴露（用户看不到 hook 的 trusted/untrusted 状态与来源），`config/batchWrite` 的 trust 写回无用户可感知入口。
- **裁定：已接入**（功能闭环）；增量 trust 状态 UI 接入 P2，2–3 人日（`browser/` customizations 视图 + `common/state/sessionState.ts` ≈200–300 LOC）。

### 12. Plugins / Marketplace — 不做

- **价值/依赖/风险**：N/A（不接入官方 marketplace）；风险为零（client-pushed 通路已满足分发）。

- **codex 侧**：`codex-rs/plugin`、`core-plugins`；协议 `v2/PluginListParams.ts`、`PluginInstalledParams.ts`、`Marketplace*Params.ts`、`PluginShare*` 等 40+ 类型。
- **VS Code 侧现状**：`codexClientCustomizations.ts:32-42` 走的是 **client-pushed** 通路（VS Code 自有 "Open Plugins" 体系投影给 codex，含 per-thread MCP 启动），非 codex `plugin/list` / marketplace API。
- **裁定：不做**（不接官方 marketplace）。理由：D06 已定自有品牌身份，官方 marketplace 携带 OpenAI 品牌与账号体系；现有 client-pushed 通路已满足插件分发。关联 D15（扩展市场生态）统一决策。

### 13. Guardian / auto-review — 已接入（保留设置项增量）

- **价值**：auto-review 策略用户可见可控；**依赖**：无；**风险**：低（设置项透传既有配置键）。

- **VS Code 侧现状**（证据）：
  - `approvalsReviewer` 透传：`codexAgent.ts:2021-2045`（`_turnStartOptions`）
  - `item/autoApprovalReview/completed` → denied-action card：`codexAgent.ts:2787/4039-4050`；`started` 仅信息性（`:3352`）
  - Guardian 审查负载：`codexGuardianReview.ts:95`（含 connector 工具调用）
  - CAPI 兼容：`codexProxyService.ts` 把 `codex-auto-review` 模型重映射到主模型（`CODEX_AUTO_REVIEW_MODEL`，注释说明 400 `model_not_supported` 会破坏整个 Auto-review preset）
- **缺口**：`codex.autoReviewPolicy` 已有配置键（`codexAgent.ts:3515-3527`），但用户侧无暴露说明/入口级 UI。
- **裁定：已接入**（核心关闭）；增量设置项暴露接入 P2，≈1 人日（`codexSessionConfigKeys.ts` + 设置声明 ≈80 LOC）。

### 14. Otel trace websocket — 不做

- **价值/依赖/风险**：N/A（不接入）；自有 OTel 服务为功能超集，风险为零。

- **codex 侧**：`codex-rs/otel-trace-websocket`（"Forwards loopback OTLP trace batches to a separate WebSocket listener"，best-effort 转发桥）。
- **VS Code 侧现状**：`codexLaunchConfig.ts:127-143 codexTelemetryOverrides` 把 codex 的 `otel.trace_exporter` / `otel.exporter` / `otel.metrics_exporter` 接到自有 `IAgentHostOTelService`（`node/otel/agentHostOTelService.ts:269 getNativeSdkTelemetryConfig`，支持外部 OTLP 端点与本地 SQLite span store loopback receiver）；`analytics.enabled=false`、`feedback.enabled=false` 属 D08 隔离决策。
- **关系**：codex 的 websocket bridge 是给"无 OTLP 接收能力"的宿主用的妥协方案；本产品已有完整 OTel 服务（含 DB span store），功能上是其**超集**。
- **裁定：不做**。

### 15. Responses API proxy — 不做

- **价值/依赖/风险**：N/A（不接入）；codex 侧为调试工具，自有 proxy 为超集，风险为零。

- **codex 侧**：`codex-rs/responses-api-proxy`（README：命令行调试代理，`--dump-dir` 落盘请求/响应对，面向开发调试）。
- **VS Code 侧现状**：`codexProxyService.ts:165 CodexProxyService`（loopback 代理 + per-process nonce、CAPI token 热轮换 `setToken`、auto-review 模型重映射、`x-vscode-codex-portable-history` 头）。
- **关系**：codex 侧是调试工具，不是生产转发层；自有 proxy 是功能超集且已承载 D04（解除 GitHub 耦合期）的关键兼容逻辑。
- **裁定：不做**。

### 16. 其他 crate（17 个，一句话裁定）

| crate | 一句话裁定（证据） |
|---|---|
| `agent-graph-store` | **不做** — "Storage-neutral parent/child topology for thread-spawned agents"（`src/lib.rs` 首行），app-server 内部子代理拓扑存储，无客户端协议面。 |
| `agent-identity` | **不做** — agent 身份/JWT 内部组件（`src/lib.rs` 为 base64/chrono 签名实现），服务侧自用。 |
| `agent-roles` | **延后** — 角色配置发现/加载（`discovery.rs`/`loader.rs`），multi-agent 编排立项时再评估。 |
| `attachment-store` | **不做** — "Storage-neutral attachment persistence interfaces"（`src/lib.rs`），服务端内部接口。 |
| `external-agent-migration` | **延后** — "Migration helpers for importing external-agent configuration"（`src/lib.rs`），协议已有 `ExternalAgentConfigImport*` 全族类型，可做"从 Claude/Cursor 导入"体验，等 onboarding 立项。 |
| `install-context` | **不做** — "Ensure a provisioned CLI still discovers its outer package and install method"（`src/lib.rs`），D09 已自建二进制供给与打包。 |
| `lmstudio` | **延后** — `--oss` 本地模型引导（LM Studio server 探测，`src/lib.rs`），若 D05 纳入本地 OSS provider 则复用。 |
| `ollama` | **延后** — 同上（Ollama server 探测），与 lmstudio 同一决策点。 |
| `mxc-sandbox` | **不做** — "Native Windows process security environment"（`src/lib.rs`），Windows 沙箱后端，app-server 内部透明使用，无需接线。 |
| `network-proxy` | **不做** — `codex-network-proxy` 内部网络组件，无客户端协议面。 |
| `process-hardening` | **不做** — `codex-process-hardening` 内部进程加固，随二进制生效。 |
| `secrets` | **不做** — secret 脱敏 sanitizer（`sanitizer.rs` "Remove secret and keys from a String"），内部日志卫生组件。 |
| `keyring-store` | **不做** — OS keyring 凭据存储（`keyring::Entry` 封装），codex 内部认证存储。 |
| `workload-identity` | **延后** — "exchange a file-backed assertion for ChatGPT auth"（`src/lib.rs`），企业 CI/无人值守场景，等企业部署立项。 |
| `aws-auth` | **延后** — Bedrock 请求签名（协议已有 `BedrockSetup*`/`AwsCredentialType`），若 D05 纳入 Bedrock provider 则复用。 |
| `thread-manager-sample` | **不做** — ThreadManager 示例代码（README 标题），非产品能力。 |
| `v8-poc` | **不做** — "Bazel-wired proof-of-concept crate reserved for future V8 experiments"（`src/lib.rs`），上游实验残留。 |

---

## 与 Colin4k1024/codex（harness，H01–H29）交叉标注

> 清单来源：`gh issue list --repo Colin4k1024/codex`（2026-09-20 拉取，H01–H29 全部 OPEN）。原则：**harness 会带来的能力不在本产品重复实现**。

| 本评估能力项 | harness 对应 | 划界结论 |
|---|---|---|
| Skills 生态 | H09「接入现有技能发现」 | harness 做 CLI 侧技能发现；本产品已接 `skills/list`/`extraRoots/set`/`skills/changed`，**两端各自闭环，不重复**。 |
| Hooks | H26「生命周期 hooks 移植」 | harness 移植 hooks 执行到 CLI 工作流；本产品已接 `hooks/list` + trust hash 写回，**不重复**。 |
| Worktree | H27「Worktree 隔离与有限并行」 | harness 在 CLI 侧做 worktree 编排；本产品用自有 `IAgentHostWorktreeIsolation`。**裁定"不复用 codex-rs/worktree"与此一致**。 |
| Memories | H29「经验候选与晋升」 | harness 的经验系统若落地，将覆盖"跨任务学习"诉求，本产品 memories UI 优先级降低（已在第 4 行标注）。 |
| 企业 provider 类（lmstudio/ollama/aws-auth/workload-identity） | H28「企业 overlay 与模型策略」 | 企业模型策略由 harness H28 统一定义；本产品对应项全部"延后"，**等 H28 结论输入，不自造配置层**。 |
| Guardian / auto-review | H13「AgentExecutor 与审批交互」 | 审批语义对齐参考；review 逻辑两端各自接 codex 协议，无重复实现风险。 |
| Otel / 可观测性 | H11「状态数据库与事件事务」、H14「VerificationExecutor」、H23「集成与兼容测试矩阵」 | harness 的验收遥测走自有事件库；本产品已有 AgentHostOTelService。**均不需要 otel-trace-websocket**。 |
| Attestation | 无对应 | harness 是 CLI 运行时（exec/TUI 路径本就不带 attestation），与本结论"不做"一致。 |
| Realtime / Cloud tasks / Apps / Code mode / currentTime / Dynamic tools / Plugins / Responses proxy | 无直接对应 | 不涉及去重；按本表裁定执行。 |

---

## Epic（D00）回灌建议：下一轮 Wave 草案

> 编排者负责落为 issue；人日为粗估。

### Wave A（P2 接入项，合计 ≈5 人日，无外部依赖，可立即排期）

| # | 项 | 内容 | 触碰文件 | LOC 量级 | 人日 |
|---|---|---|---|---|---|
| A1 | `currentTime/read` 防御性接入 | server-request handler 回应本机 Unix 秒，消除 turn 阻断风险 | `codexAgent.ts` | +50 | 0.5 |
| A2 | `skills/config/write` | UI 启停单个 skill | `codexAgent.ts`、`codexSessionConfigKeys.ts`、设置 UI | +120 | 1 |
| A3 | Hooks trust 状态 UI | 暴露 `HookTrustStatus`/`currentHash`，trusted 写回入口 | `browser/` customizations 视图、`common/state/sessionState.ts` | +200~300 | 2–3 |
| A4 | Guardian 设置项暴露 | `codex.autoReviewPolicy` 用户可见入口与文档 | `codexSessionConfigKeys.ts`、设置声明 | +80 | 1 |
| A5 | `deferLoading` 透传 | AHP `agentServerTools.ts:19` 字段接入 `_buildDynamicTools` | `codexAgent.ts` | +20 | 0.5–1 |

### Wave B（产品决策依赖，等 D03/D05/D10 定稿后立项）

- Apps/Connectors（mention + metadata/branding 渲染，10–15 人日）
- Memories（管理 UI + 隐私边界，4–6 人日，先看 harness H29 结论）
- Realtime/语音（协议去 EXPERIMENTAL 后重评，8–15 人日）
- external-agent-migration 导入体验（onboarding 立项时）
- 企业 provider 复用（lmstudio/ollama/aws-auth/workload-identity，等 harness H28）

### 不做清单（冻结，除非上游协议或产品定位变化）

attestation（不可补救，见文首）、官方 marketplace/插件 API、codex-rs/worktree 复用、otel-trace-websocket、responses-api-proxy、cloud tasks（暂定，待 D05 后产品复议）、上表 17 个 crate 中标注"不做"的 12 项。

### 回灌 D03/D05 的观测项（非 issue，入验收矩阵）

ChatGPT 认证路径出现新形态 401/403/429（区别于常规 quota 错误）时，作为 attestation 政策收紧早期信号升级评估。

---

*裁定统计：接入/已接入（含增量）5 项（A1–A5；其中 dynamic tools、skills、hooks、guardian 四行主体为已接入）；延后 11 项（能力行 5：realtime/cloud-tasks/apps/memories/code-mode + crate 6）；不做 16 项（能力行 5：attestation/worktree/plugins/otel-ws/responses-proxy + crate 11）。合计 32 项 = 15 能力行 + crate 行展开 17 项。*
