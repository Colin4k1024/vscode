# 核心验收逻辑（Invariant / Negative / Concurrency / Side-effect）

本文件是 D11–D13 三张 Issue 的**共享验收内核**。所有验收标准以"可执行断言"表述，不接受"人工看起来对"。

约定：
- **AHP** = Agent Host Protocol（Renderer ↔ Agent Host，JSON-RPC over WebSocket/MessagePort）
- **ASP** = Codex app-server protocol（Agent Host ↔ `codex app-server` 子进程，JSONL over stdio）
- 断言层级：`unit`（vitest/mocha 单测）、`replay`（确定性 e2e，`test/node/e2e/captures/*.yaml`）、`live`（`AGENT_HOST_REAL_CODEX=1`）、`manual`（需真人，须记录截图/日志）

---

## A. 状态机不变量（State-machine invariants）

### A1. 协议层级：ASP 的 turn 生命周期

**状态集**：`idle → starting(turn/start accepted) → started(turn/started) → active(items streaming) → {completed | failed | interrupted}`

| # | 不变量 | 断言方式 | 层级 |
|---|---|---|---|
| A1.1 | `turn/start` 的**响应返回**不等于 turn 开始运行；只有 `turn/started` 通知才是运行起点 | replay：断言在 `turn/start` result 与 `turn/started` 之间，AHP 侧 `activeTurn` 状态为 `pending` 而非 `running` | replay |
| A1.2 | 一个 thread 在任意时刻**至多一个** active turn | live：并发两次 `turn/start` → 第二次必须被拒或排队，不得产生两个 `activeTurn` | live + unit |
| A1.3 | 终态事件（`turn/completed` / `turn/failed`）**不可丢失**；即使客户端在流式过程中慢消费 | replay：注入人为背压后仍断言收到终态 | replay |
| A1.4 | `turn/interrupt` 后必须观察到 `turn/completed` 且 `status` 表达中断；**不得**出现"进程仍在跑但 AHP 已 cancelled" | live：interrupt 后轮询子进程存活 + AHP `activeTurn === undefined`，二者必须一致 | live |
| A1.5 | 状态转移**单调**：不得从 `completed` 回到 `active` | unit：对 `codexMapAppServerEvents.ts` 的 `createCodexSessionMapState`/`finalizeCodexTurnMapState` 做转移表穷举测试 | unit |

> 交叉引用：`Colin4k1024/codex#2`（H02）已把"进程在运行但状态已 cancelled"列为禁止项；`#3`（H03）要求为"请求已发出但未记录响应"定义 `uncertain`。**直接复用其结论，不重新推导。**

### A2. 协议层级：Item 生命周期

| # | 不变量 | 断言 | 层级 |
|---|---|---|---|
| A2.1 | 每个 `item/started` 必须最终有配对的 `item/completed`，或在其所属 turn 终态时被显式清理 | replay：对 103 个 capture 全量扫描，`started` 与 `completed` 的 `itemId` 集合必须相等（或差集全部落在 turn 终态清理窗口内） | replay |
| A2.2 | `commandExecution` item 的最终 `status ∈ {completed, failed, declined}` 是**权威结果**；不得用 `item/started` 的 `inProgress` 覆盖终态 | unit：`mapItemCompleted` 后再喂 `mapItemStarted` 同 id → 状态不得回退 | unit |
| A2.3 | `fileChange` item 的 `changes`（diff 摘要）在 `completed` 后必须与 `agentHostResponseFileChanges` / changeset 聚合一致 | replay：`codex-session-changeset-aggregates-provider-edits-from-default-and-peer-chats.yaml` 已覆盖；扩展到 peer + 默认 chat 混合场景 | replay |
| A2.4 | `item/agentMessage/delta` 的拼接结果 == `item/completed` 里 agentMessage item 的全文 | replay：`codex-preserves-a-fenced-multiline-markdown-response.yaml` 已覆盖；补 unicode / 代码围栏 / 跨 chunk 分割 | replay |

### A3. 审批闭环（**最高风险区**）

server→client 请求共 7 类：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/tool/call`、`attestation/generate`（当前 `requestAttestation: false`）。

| # | 不变量 | 断言 | 层级 |
|---|---|---|---|
| A3.1 | **每个** server request 最终必须产生 `serverRequest/resolved {threadId, requestId}`——包括用户接受、拒绝、取消，**以及 turn 开始/完成/中断导致的清理** | replay + live：维护 `pendingRequestRegistry`（`common/pendingRequestRegistry.ts`）快照；turn 终态后 `pending.size === 0` | replay + live |
| A3.2 | 未响应的审批请求 → turn **必须挂起**，不得超时后静默按"接受"处理（**fail-open 禁止**） | unit：mock client 不响应 → 断言无 `item/completed`、无副作用发生 | unit |
| A3.3 | `decision` 取值收敛：非 `{accept, acceptForSession, decline, cancel}` 及 `acceptWithExecpolicyAmendment` / `applyNetworkPolicyAmendment` 结构体之外的输入 → 归一为 `decline`（`codexAgent.ts:1104-1110` 已有 default 分支） | unit：穷举畸形输入 | unit |
| A3.4 | `acceptForSession` 的作用域**严格限于当前 thread/session**，不得泄漏到其他 session | live：两个并发 session，A 接受 forSession，B 必须仍收到审批请求 | live |
| A3.5 | `writeStdin` 类审批（`kind: "writeStdin"`）不得改变父 `commandExecution` item 的状态 | unit + replay | unit |
| A3.6 | 审批 UI 的**权限授予子集**语义：`result.permissions` 中未出现的权限一律视为拒绝；请求中不存在的权限被忽略；`scope: "session"` 才跨 turn 生效 | unit：`resolveCodexPermissions` / `narrowAdditionalDirectories` 穷举 | unit |
| A3.7 | `requestUserInput` 的 `isBlocking: true` → 客户端必须**无限期等待**显式输入；不得用已废弃的 `autoResolutionMs` 自动应答 | unit | unit |
| A3.8 | **澄清请求与权限批准不可互相替代**（`Colin4k1024/codex#20` H20 的结论）：elicitation 的 `accept + content` 不能被解释为权限授予 | unit | unit |

### A4. Agent Host 编排不变量 I1–I8（`src/vs/platform/agentHost/AGENTS.md`）

这 8 条目前**只是文档**。D12 的任务是把它们变成可执行守卫。

| # | 不变量 | 可执行断言 |
|---|---|---|
| **I1** | `providerData` 对 host 不透明 | lint/type 守卫：`AgentService` 与 `AgentHostStateManager` 中不得出现对 `providerData` 的 `JSON.parse` / 属性访问（AST 扫描）；replay：create → host restart → materialize，`providerData` 字节级相等 |
| **I2** | session URI 与 chat channel URI 不混用 | unit：`isAhpChatChannel` / `parseDefaultChatUri` / `buildDefaultChatUri` 往返测试；property-based：随机 session URI 不得被 `isAhpChatChannel` 判真 |
| **I3** | 默认 chat 走与所有 chat 相同的显式 backing 契约 | replay：默认 chat 的 `providerData` 缺失时，只能由 provider 从 session URI 里的 provider-native id 恢复，**不得**假设 `sessionId === threadId`（Codex 明确不成立，见 AGENTS.md §6） |
| **I4** | 单一 catalog 入口 | 静态守卫：`_chatEntries` 的写入点只允许 `addChat` / `registerRestoredChatSummary` / `removeChat`（AST 扫描）；replay：spawn-channel 监听器必须在 `AgentSideEffects` 之前注册（DR1 顺序） |
| **I5** | 中央 peer-chat catalog 是恢复的唯一真源 | replay：`codex-peer-chat-catalog-and-transcript-survive-a-host-restart.yaml` 已覆盖；补：中央 catalog 为空数组（authoritative empty）时**不得**复活已删除 peer |
| **I6** | 一律经 `IAgentHostProviderService` 路由 | 静态守卫：provider 代码不得直接读 association map；restore 前必须 re-associate |
| **I7** | peer chat 的 backing SDK session **绝不**出现在顶层 session 列表 | replay：`createChat` 返回 `backingSession` 后，`listSessions` 结果不含该 URI；**负向**：`_markChatBacking` 写失败一次 → 该 session 在本进程内被抑制（`_unpersistedChatBackings`），而非让创建失败 |
| **I8** | provider 只消费 host 事实，不自行推导 | 静态守卫：`node/codex/**` 不得 import `AgentHostStateManager`（AGENTS.md 自述 Codex 切片**尚未转换完**——这是已知技术债，D12 需登记为 baseline 而非直接失败） |

### A5. 会话/线程身份不变量（Codex 特有）

| # | 不变量 | 断言 |
|---|---|---|
| A5.1 | `_sessionIdByChatUri` 只用于**精确 chat 路由**，不得用于恢复 AH 成员关系 | unit：未绑定的 chat URI → 拒绝（不得静默创建） |
| A5.2 | `_sessionIdByThreadId` 用于 app-server 回调路由；thread 未注册时回调必须被丢弃而非崩溃 | unit：喂入未知 threadId 的 `item/completed` → 无异常、有日志 |
| A5.3 | 恢复/续聊**保留已存模型**；模型不在目录时，等待排队的 model discovery，然后从**同一 native provider** 选首个可用模型 | replay：`codex-model-changes-between-turns-retain-provider-context.yaml` + 新增"已存模型缺失"用例 |
| A5.4 | **绝不跨计费 provider 切换**：即使另一个 provider 列出同名模型 | unit：`_resolveRestoredModel` 穷举 |
| A5.5 | 已存 provider 无可用模型时，保留其选择以便历史可读；只有**从未选择过**的 thread 才用全局默认 | unit |
| A5.6 | `thread/resume` 必须显式带上 model + provider，否则 SDK 会用它自己的默认值 | replay：断言出站 `thread/resume` params 含 `model` 与 `modelProvider` |
| A5.7 | 元数据/历史读（`thread/read`、`thread/turns/list`）**不得** resume thread 或抢占 writer lock | live：同一 thread 在另一个 codex 客户端打开时，VS Code 侧仍能读 |
| A5.8 | 显式切换 provider 只在**下次 send** 时 reload 同一 native thread；不得创建替代会话、不得清空 turn-id 映射 | replay：`codex-provider-switch` 相关；断言 threadId 不变 |
| A5.9 | `agentHost.codexProviderSwitch` 遥测**只在** `turn/start` 于同一 thread 接受后才计数 | unit：picker 改动 / 元数据读 / setup-only resume / 失败 send / send 前回退 → 均不计数 |

---

## B. 负向场景（Negative scenarios）

每条都必须有**自动化用例**，且断言"用户可见的错误信息可操作"，不是裸堆栈。

| # | 场景 | 期望行为 | 禁止行为 |
|---|---|---|---|
| B1 | Codex 二进制不存在 / 不可执行 | 明确错误 `Codex binary not executable: <path>`；provider **不注册**；agent picker 里不出现 Codex；banner 提供下载/设置 sdkRoot 入口 | 崩溃；静默降级到其他 provider；反复重试拖垮启动 |
| B2 | `product.agentSdks.codex` 缺失且无 env override（**出厂构建**） | downloader 抛 `no \`product.agentSdks.codex\` configured`；`AgentChatMigrationDeferred` → **不推进** migration marker，**不阻塞**其他健康 provider 的聚合 listing | 把 deferred 当失败；清空已有 session 列表快照 |
| B3 | codex 版本 ≠ `build/codex/codex-version.txt` | `codex:gen-protocol` 失败并给出实际/期望版本；CI `check-protocol-sync --if-changed` 退出码 1 | 静默生成不匹配的类型 |
| B4 | `initialize` 握手超时 | 该连接 fatal；`_connection` 回到 `idle`；不留下半开子进程 | 挂住整个 Agent Host |
| B5 | app-server 子进程崩溃（SIGKILL） | `_connection` 失效 → 下次操作重建；**所有 pending server request 必须被 resolved/清理**（A3.1）；已流式内容保留（AGENTS.md 决策 15：cancel, keep streamed content） | pending 永久悬挂；turn 卡在 `active` |
| B6 | Agent Host 进程崩溃后重启 | `restoreSession` 走 I5 中央 catalog；peer chat 为 catalog-only 直到 resolver 成功；失败的 resolver **保留 summary 且可重试** | 丢失会话；把 resolve 失败当删除 |
| B7 | 连接被替换（`CodexConnectionReplacedError`） | `generation` 不匹配的迟到结果必须被丢弃；`_disposeConnectionResources(ready)` 被调用 | 迟到写入覆盖新连接状态 |
| B8 | JSON-RPC `-32001 Server overloaded` | 指数退避 + jitter 重试；重试次数有上界；用户可见"暂时繁忙" | 立即密集重试；把 -32001 当永久失败 |
| B9 | 无 GitHub token 且未显式选模型 | **不得**直接抛 `AHP_AUTH_REQUIRED`（这是 G5 要修的）；应落到 OpenAI provider 或给出可操作引导 | 要求 GitHub 登录 |
| B10 | 仅 API Key 认证（无 ChatGPT 订阅） | 目录可用、能发起 turn（这是 G4 要修的：当前映射为 `unavailable`） | 显示"不可用" |
| B11 | ChatGPT 登录被取消（`account/login/cancel`） | `account/login/completed {success:false}` → UI 回到未登录态；不留 pending loginId | 卡住登录 spinner |
| B12 | OAuth 回调端口被占 / 浏览器未打开 | app-server 自持本地回调；VS Code 侧展示 `authUrl` 供手动打开；超时可取消 | 死等 |
| B13 | 用户 `~/.codex/config.toml` 试图放宽 `vscode-workspace` profile | VS Code 注入的 `-c` 覆盖**优先**；permission profile 不被提权；网络默认关闭 | 用户配置提权成功 |
| B14 | 工作目录不是 git 仓库 | 明确提示；提供 `skipGitRepoCheck` 等价开关或引导初始化 | 不可恢复错误 |
| B15 | 工作目录在会话中途被删除/替换 | `AgentWorkingDirectoryChangedError`；新目录成为**不可逆的权威**后不得回滚 | 静默写到错误目录 |
| B16 | MCP server 启动失败 / OAuth 过期 | `mcpServer/startupStatus/updated` → `failed` + `failureReason: reauthenticationRequired` → 提示重连该 server；**不阻塞** turn | 整个会话不可用 |
| B17 | elicitation 请求含**未知语义输入** | 图形客户端显示"不支持"状态，**等待用户 decline/cancel**；不得返回 JSON-RPC error，不得渲染半个表单或退化成通用审批 | 部分渲染；自动 decline |
| B18 | dynamic tool 响应体为空 | `dynamicToolResponseFromResult` 必须回填非空 `inputText`（past-tense summary 或通用完成标记） | codex 拒绝空 body 导致 turn 失败 |
| B19 | dynamic tool 响应含远程 HTTP 图片 URL 或非 data: 音频 URL | 视为无效响应；不得发出 | 发出后被 app-server 拒绝 |
| B20 | `writeStdin` 审批的 action/reason 超过 **8000 字节** | 在任何字节到达终端**之前**拒绝 | 审查缩短版却执行完整版 |
| B21 | 沙箱临时目录（`vscode-agent-codex-sandbox-*`）残留 | 连接失败路径必须 `rm -rf`（`_startRawConnection` catch 块已有）；正常退出也清理 | 泄漏 tmpdir |
| B22 | profile image 超过 1MiB / 不支持的 media type / nonce 不匹配 URI | `readProfileImageReference` 返回 undefined；不渲染 | 任意 URI 注入 |
| B23 | `thread/list` 分页返回超大结果 | `THREAD_LIST_MAX_PAGES` 上界生效；超出部分明确截断 | 无限拉取 |
| B24 | 归档一个从未恢复过的 session 后重启 host | replay：`codex-archiving-a-never-restored-session-survives-a-host-restart.yaml` 已覆盖 | 归档状态丢失 |
| B25 | 对一个 turn 已暂停等待输入的会话执行取消 | replay：`codex-cancelling-a-turn-paused-for-input-allows-a-replacement-turn.yaml` 已覆盖；取消后必须能起替代 turn | 永久卡死 |
| B26 | 策略 `Codex3PIntegration` 被托管设置为禁用 | provider 全表面不可用；设置项显示策略锁定 | 用户可绕过 |
| B27 | 两个窗口同时操作同一 thread | 只读路径（A5.7）不冲突；写路径由 app-server writer lock 决定，VS Code 侧不得静默丢失另一方的 turn | 数据竞争导致历史错乱 |
| B28 | 磁盘满 / `agent-host.db` 写失败 | `_persistDefaultChatBacking` 的两个写相互独立：blob 写失败被记录并吞掉，**不得**跳过 backing marker（I5） | 默认 chat 的 backing 泄漏到顶层列表 |

---

## C. 并发 / 崩溃 / 恢复

### C1. 并发

| # | 场景 | 断言 |
|---|---|---|
| C1.1 | 同一 session 的多个 chat（peer）**并发 turn** | `_sessionsWithActiveTurn` 是"每 session 一组 chat URI"，多 chat 并发必须各自正确（AGENTS.md §Orchestrator） |
| C1.2 | 两个 peer chat 写**不同**工作区文件 | replay：`codex-two-peer-chats-write-distinct-workspace-files.yaml` |
| C1.3 | 两个 peer chat 保持**独立** provider context | replay：`codex-two-peer-chats-keep-independent-provider-contexts.yaml` |
| C1.4 | `listSessions()` 在多窗口恢复突发下 | 每 external-sessions mode **合并**为一次 registry 遍历；mutation 推进 epoch 但不移除进行中的计算；后到者共享一次 trailing 计算；每个 caller 拿到**自己的数组** |
| C1.5 | 同一 peer 的 `resolveChatState` 并发 | 合并为一次 materialization；失败可重试；成功时**原子**发布完整 state |
| C1.6 | `_refreshModels` 并发触发 | `_modelRefreshSequencer` 串行；`_modelsRefreshPromise` 自清理；认证可排入更新的 refresh，`_resolveRestoredModel` 必须**跟随最新排队的 refresh** 直到 sequencer 空闲 |
| C1.7 | 连接启动与取消竞争 | `_connectionGeneration` + `raceCancellationError`；迟到的 ready 连接必须被 `_disposeConnectionResources` |
| C1.8 | 代理 token 轮换（`setToken`）与在途请求 | 在途请求用**派发时捕获**的 token；新请求用新 token；子进程与 nonce 不变 |
| C1.9 | 多窗口共享一个 app-server（refcount） | 最后一个 chat 释放后才回收 managed working directory；`_releasedManagedWorkingDirectories` 不泄漏 |
| C1.10 | proxy 的子进程所有权不变量 | **任何**拿到 `baseUrl`/`nonce` 的子进程必须在 handle dispose **之前**被 kill；否则下次 `start()` 可能换端口，子进程静默失去 endpoint（`codexProxyService.ts` 显式声明） |
| C1.11 | MCP 清单刷新并发 | replay/unit：`codex-Coalesce Codex MCP inventory refreshes`（`b376c21d3e4`）——并发刷新合并 |
| C1.12 | user-config 写入并发 | 版本检查写入被 `_providerConfigurationWrite` 串行化；冲突时**有界重试**重读；持久冲突在 unsubscribe/resume **之前**失败 |

### C2. 崩溃

| # | 场景 | 断言 |
|---|---|---|
| C2.1 | `codex app-server` 子进程崩溃 | 见 B5。补：崩溃时正在进行的 turn → AHP 侧进入终态且 `activeTurn` 清空；pending server request 全部 resolved |
| C2.2 | Agent Host utility process 崩溃 | Renderer 收到 `onDidProcessExit {code, signal}`；重启后走 C3 恢复；**不得**让 Renderer 崩 |
| C2.3 | Renderer 崩溃 / 窗口强杀 | Agent Host 侧 `shutdown()` 被调用或超时后被 dispose；子进程不残留（`ps` 断言无 `codex app-server` 孤儿） |
| C2.4 | 应用在 `turn/start` 已发出但未收到 result 时崩溃 | 恢复后该 turn 状态为 **`uncertain`**，不得当作未发生、也不得当作成功（`Colin4k1024/codex#3` H03 结论）；**不得**把 JSON-RPC request id 当持久化幂等键 |
| C2.5 | 应用在 `item/completed` 已收到但未落盘时崩溃 | 恢复后由 provider-native rollout（`~/.codex/sessions`）重建；VS Code 侧 `agentSessionData` 与 rollout 不一致时以 rollout 为历史权威 |
| C2.6 | 崩溃后 `vscode-agent-codex-sandbox-*` tmpdir 泄漏 | 启动时清理陈旧目录，或有上界；不得无限累积 |
| C2.7 | 崩溃发生在 `_markChatBacking` 之前 | 恢复后默认 chat 的 backing thread 可能泄漏到顶层列表 → 必须有修复路径（catalog maintenance pass） |

### C3. 恢复

| # | 场景 | 断言 |
|---|---|---|
| C3.1 | Host 重启后 session 元数据/历史/provider context 存活 | replay：`codex-session-metadata-history-and-provider-context-survives-a-host-restart.yaml` |
| C3.2 | Host 重启后图片附件仍可读 | replay：`codex-codex-image-attachments-remain-readable-after-a-host-restart.yaml` |
| C3.3 | Host 重启后 peer catalog + transcript 存活 | replay：`codex-peer-chat-catalog-and-transcript-survive-a-host-restart.yaml` |
| C3.4 | 恢复的 peer chat 在 resolver 成功前是 **catalog-only** | `getChatState` 是同步无 I/O 的 peek；需要内容必须走 `resolveChatState` |
| C3.5 | 恢复不得抢占别的客户端仍打开的 thread | A5.7：`thread/read` + `thread/turns/list` 不 resume、不抢 writer lock |
| C3.6 | 首次 send 才 resume backing thread、应用待处理 launch config；只有 SDK 报告 rollout 缺失时才替换从未持久化的 backing | unit + replay |
| C3.7 | 跨 ChatGPT app ↔ VS Code 的 session handoff | replay：`f963c5892e6`（preserve Codex threads across subscription switches and support session handoff）已覆盖；补订阅切换后历史可读 |
| C3.8 | 分页 thread 的恢复 | `4df534bb7cb`（Fix Codex recovery for paginated threads）；补：分页中途 host 重启 |
| C3.9 | `sourceUnresolvable` vs `providerUnavailable` 必须分别报告 | `providerUnavailable`（未注册）→ 廉价检测、注册即解、在 claim 任何存储**之前**守卫；`sourceUnresolvable`（已注册但无法背书）→ **park**（内存态、不 tombstone、不清 `payloadDirty`、重启后各重试一次再 park） |
| C3.10 | 单次 lookup 失败**不得**被当作"不存在"的证据 | SDK 仍在下载与已被 prune 不可区分 → parking 永不 tombstone |
| C3.11 | 客户端只把**成功返回**当权威 | `listSessions()` reject 时保留上次成功快照；成功返回空数组才清空快照。**传输/认证/catalog 失败不得变成删除 delta** |
| C3.12 | `chat.agentHost.sessionCatalog.enabled` 是回滚杆 | 首次读取后冻结（运行中不得换 store backing），改动需重启；关闭时无 catalog import、无后台修复、`listSessions` 走 provider+per-session fallback；registry 身份与所有兼容写不受影响；verification marker 被清空以便下次启用时全量重验 |

---

## D. 外部副作用检查（External side-effect checks）

这是"能不能安全发布"的门。每条都要有**可自动化验证**的检查手段。

| # | 副作用面 | 检查 | 期望 |
|---|---|---|---|
| D1 | **网络出口白名单** | 在隔离网络（或 mitmproxy）下跑完整 e2e + 一次真实 turn，抓取所有出站连接 | 只允许：OpenAI（`chatgpt.com` / `api.openai.com` / `auth.openai.com`）、用户自配的 MCP server、（可选）自建 SDK CDN、Open VSX 扩展注册表（`open-vsx.org` 与其文件 CDN `openvsx.eclipsecontent.org`，D15/#17 裁定，见 D15-GALLERY.md）。扩展 readme/图标等内容渲染引入的第三方主机（如 `img.shields.io`、`raw.githubusercontent.com`）属用户触发浏览的内容驱动出口，不在本白名单约束内（D15-GALLERY.md 附录 B.8 有实测聚合）。**禁止**：`main.vscode-cdn.net`（除非 D09 改成自托管）、`*.vscode-cdn.net` webview 模板、MS/GitHub 遥测端点（若 D08 关闭） |
| D2 | **Codex 自带分析** | 断言 spawn args 含 `analytics.enabled=false`、`feedback.enabled=false` | 恒为 false，即使用户开启 Agent Host OTel（`codexTelemetryOverrides` 注释明确：产品分析必须被压制） |
| D3 | **OTel 默认关闭** | 断言未配置时 `otel.trace_exporter="none"`、`otel.exporter="none"`、`otel.metrics_exporter="none"` | 无静默上报 |
| D4 | **`otel.log_user_prompt`** | 断言其值 == `config?.captureContent ?? false` | 用户提示内容默认**不**外发 |
| D5 | **凭据落盘** | 扫描 `<userDataDir>` / `<CODEX_HOME>` / `agent-host.db` / 日志，搜 token 形态字符串 | 无明文 GitHub token、无 OpenAI token、无 proxy nonce 落到日志或 DB；`agent-host.db` 只存**脱敏配置摘要** |
| D6 | **代理 nonce 生命周期** | unit + live：连接 dispose 后 nonce 失效；子进程先于 handle 被 kill（C1.10） | 无"僵尸子进程持有效 nonce" |
| D7 | **文件系统写入边界** | 在 `read-only` / `vscode-workspace` profile 下让 agent 尝试写工作区外路径、写 `.env`、写 `~/.codex/config.toml` | 被沙箱拒绝；`:root = deny`、`:minimal = read`、`:tmpdir = write`、`:slash_tmp`（Linux=read / 其他=deny）生效 |
| D8 | **网络默认关闭** | `vscode-workspace` profile 下发起出站连接 | 被拒（`network = { enabled = false }`）；只有 `vscode-workspace-network` 才放行 |
| D9 | **`TMPDIR` 隔离** | 断言 spawn env 的 `TMPDIR`/`TMP`/`TEMP` 指向 `vscode-agent-codex-sandbox-*` | 沙箱临时区与用户 tmp 隔离 |
| D10 | **`CODEX_HOME` 尊重用户设置** | 设 `chat.agentHost.codexAgent.codexHome` → 断言子进程 env `CODEX_HOME` 一致；"打开配置文件"动作也必须用同一 effective home | 一致 |
| D11 | **`AiAgentEnvVar` 标记穿透 shell 策略** | 断言同时在 env 与 `shell_environment_policy.set.*` 中注入 | 用户 `inherit = "core"` 策略不会丢掉标记 |
| D12 | **不修改用户既有 codex 状态** | 跑完整 e2e 前后 diff `~/.codex/`（或测试用 CODEX_HOME） | 除本会话新建的 rollout 外无改动；**不重写**既有 rollout 文件；不自动 git commit / reset |
| D13 | **e2e 环境隔离** | 断言测试用临时 home + 临时 userDataDir；`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 等 ambient override 被清空；teardown 在 agent host 退出后删目录 | 本地配置/MCP/session 不影响结果 |
| D14 | **replay 严格性** | 未录制的请求 = 硬失败；每条录制的模型响应必须在 teardown 前被消费完 | CI 永不静默访问真实后端；提前停止的 provider 不能靠"留下未用 fixture"通过 |
| D15 | **Git 副作用** | worktree isolation 场景下，断言只在解析出的 worktree 内写；`applyCommitsToParentRepo` 需显式用户动作 | 不污染父仓库工作树 |
| D16 | **进程残留** | 完整跑一轮后 `pgrep -f 'codex app-server'` | 空 |
| D17 | **遥测字段最小化** | 断言 `agentHost.codexProviderSwitch` 事件不含 prompt、模型名、路径、会话标识；`chatgptWeeklyUsedPercentBucket` 只在显式 7 天窗口 + 5 分钟内观测 + 未过 reset 时出现，且向下取 10 点桶（仅耗尽时为 100）；缺失/无效/过期/陈旧配额数据**省略**而非报 0；账号变更时清空样本；不额外发配额请求、不等待配额 | 与 `AGENTS.md` §6 Codex 段落逐条对齐 |
| D18 | **构建产物不含 MS 私有物** | 扫描打包产物：`product.json.defaultChatAgent`、`builtInExtensions`、`extensionsGallery`、`webviewContentExternalBaseUrlTemplate`、`agentsTelemetryAppName` | 按 D08/D09/D15 的裁定结果一致 |
| D19 | **许可清单** | 生成打包产物的第三方许可清单（`cglicenses.json` / `cgmanifest.json` 对应物） | 含 `@openai/codex`（Apache-2.0）与所有 Rust 静态链接依赖；无未声明的 GPL/AGPL |
| D20 | **签名/公证** | macOS：`codesign --verify --deep --strict` + `spctl -a -vvv` + notarization ticket；Windows：Authenticode 校验 | 全部通过（首版可作为 D11 的显式"不做"项，但必须记录） |

---

## E. 验收门禁汇总（放行标准）

**MVP 门（内部可用）**：D01 + D02 + D03 + D04 + D05 + D11 + D12 + D13 全绿
- `./scripts/code.sh --agents` 在本机启动，Codex 出现在 session type picker
- **零 GitHub 登录**、仅 OpenAI 凭据（ChatGPT 或 API Key）完成一次真实 turn：写文件 + 跑命令 + 审批 + 中断 + 恢复
- A 段全部不变量有可执行断言且通过
- B 段 B1–B14、B17–B21、B25 有自动化用例且通过
- C 段 C2.1–C2.5、C3.1–C3.6、C3.11 有自动化用例且通过
- D 段 D2–D5、D7–D14、D16 通过

**发布门（可对外分发）**：追加 D06 + D08 + D09 + D10 + D15
- D 段 D1、D6、D15、D17–D20 通过
- D10 合规裁定书面结论存在且被 D06/D08/D09 引用

**非阻断（后续）**：D07（形态优化）、D14（上游同步，但首次升级前必须完成）、D16（能力扩展评估）
