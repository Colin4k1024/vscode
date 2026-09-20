# Codex Desktop — live-only 与非 replay 场景清单

> 来源：Issue #13（D11 确定性 replay 验收矩阵扩展）。
> 判定标准：一个场景只有**不能**在 `src/vs/platform/agentHost/test/node/e2e/` 的确定性
> replay harness 中表达时，才允许出现在这里；每项必须说明"为什么不能确定性重放"，
> 以及它由哪个套件/层级兜底。replay 能覆盖的一律进 replay 矩阵，不得以本清单为借口漏测。

## A. Live-only（真实 app-server + 真实模型，AGENT_HOST_REAL_CODEX=1）

这些场景在 `src/vs/platform/agentHost/test/node/e2e/providers/codexAgentHostLive.integrationTest.ts`
中跑真实 Codex app-server，**不进** replay 矩阵。

| 场景 | 为什么不能确定性重放 | 兜底位置 |
|---|---|---|
| Mid-turn steering（`turn/steer`） | 消息在模型流式输出**进行中**到达，依赖 app-server 的实时缓冲/提升（pending bubble → 新 turn）的时序语义。replay 的响应是整段即时送达的录制品，模型"回合中途"这一时间窗口在 replay 里不存在。 | live suite：`mid-turn steering clears pending state without getting stuck` |
| Late tool registration（session 创建后注册 client tool） | Codex 在首个 turn 前 prewarm thread；后注册的工具能否生效取决于 prewarm 是否已完成——公开 AHP 没有 thread-prewarm 就绪信号，replay 下这是一个无法稳定复现的竞态。 | live suite：`client tool registered after session creation is still invoked` |
| Truncate（`thread/rollback` 语义） | 截断重写 provider 侧历史，正确性依赖 app-server 内部 rollback 状态机与后续 turn 的真实交互；replay 的请求序列断言假定录制时的历史形态，rollback 后的派生请求序列不可移植复现。 | live suite + `codexForkPlan`/`codexReplayMapper` 单测 |
| Mid-turn abort | 取消信号必须落在模型响应**流式中途**才有意义；replay 即时返回完整响应，没有可注入取消的时间窗。所有 provider 均为 record-only（见 e2e README「Interpreting Codex pending tests」）。 | 各 provider 套件的 record-only abort 用例 |
| GitHub MCP server 端到端握手 | replay 中 GitHub MCP 引导被显式 404 stub（`capiStubs.ts`），真实 OAuth/握手只能在 live 下发生。 | live / 手动验收 |

## B. 非 replay 可表达 —— 由单元测试层兜底（非 live-only）

以下 B 段负向场景无法通过"AHP over WebSocket + 录制模型流量"外部表达
（replay harness 只能驱动协议边界与模型边界，无法注入 app-server 内部错误），
由 `src/vs/platform/agentHost/test/node/` 单测覆盖（D13 领域）：

| 场景 | replay 不可表达的原因 | 单测兜底 |
|---|---|---|
| B2：`product.agentSdks.codex` 缺失（出厂构建） | 这是构建期 product 配置缺失，e2e harness 无法从外部摘除 product.json 字段；downloader 的 `no product.agentSdks.codex configured` 路径与 `AgentChatMigrationDeferred` 只能在内层触发。 | `test/node/agentService.test.ts`（migration deferred） |
| B7：连接被替换（`CodexConnectionReplacedError`） | generation 不匹配的迟到结果丢弃是 host↔app-server 连接管理的内部竞态，AHP 外部无触发面。 | `test/node/codex/codexCreateChat.test.ts`（`drops thread history returned by a replaced app-server` 等）、`codexAppServerClient.test.ts`（迟到响应丢弃） |
| B8：JSON-RPC `-32001 Server overloaded` 重试 | 错误发生在 host↔app-server 的 JSON-RPC 链路上；e2e 起的是真实 app-server 子进程，无法注入该错误帧。 | `test/node/codex/codexAppServerClient.test.ts`（-32001 用例） |
| B17：elicitation 未知语义输入（`openai/form`） | host 在 `initialize` 未声明 `mcpServerOpenaiFormElicitation` capability，codex 因此对 `openai/form` elicitation 直接内部 decline，**从不转发给 host**——replay 层没有可观察的触发面；decline/cancel 映射由映射器单测覆盖（`mode: form`/`url`）；`openai/form` 的 message-only 兜底分支无单测（capability 未声明，replay 与单测均无可观察面）。 | `test/node/codex/codexElicitationMapper.test.ts` |
| B28：磁盘满 / `agent-host.db` 写失败 | `_persistDefaultChatBacking` 的 blob 写失败注入需要控制 host 进程内的文件服务；e2e 的隔离目录语义不支持精确制造"blob 写失败但 marker 写成功"的部分失败。 | `test/node/agentService.test.ts` |

## C. 已由 replay 矩阵覆盖的 B 段场景（本批次新增/确认）

| 场景 | replay 覆盖 |
|---|---|
| B1：Codex 二进制不可执行 | `codexAgentHostE2E.integrationTest.ts` › `an unusable Codex SDK root fails chat setup fast without wedging the host`（host-only，empty fixture，断言 `chat/error` 含 `Codex binary not executable: <path>`、host 不 wedge、其他 provider 不受影响、零模型流量） |
| B16：MCP server 启动失败 | 同文件 › `a failing MCP server surfaces an error state without blocking the turn`（capture：`codex-a-failing-mcp-server-surfaces-an-error-state-without-blocking-the-turn.yaml`）。OAuth 过期子场景依赖真实 OAuth 握手，属 live/手动。 |
| B18：dynamic tool 空响应回填 | 同文件 › `a client tool call with an empty result body is backfilled before it reaches the model`（capture：`codex-a-client-tool-call-with-an-empty-result-body-is-backfilled-before-it-reaches-the-model.yaml`） |
| B24：归档未恢复 session 后重启 | 已有 `codex-archiving-a-never-restored-session-survives-a-host-restart.yaml` |
| B25：取消已暂停等待输入的 turn | 已有 `codex-cancelling-a-turn-paused-for-input-allows-a-replacement-turn.yaml`（parity 套件，`supportsPausedTurnCancellationE2E`） |

## D. replay 严格性 / 隔离性（D14 / D13 验收项）

- 未录制请求 = 硬失败：harness 既有语义（`CapiReplayProxy` strict 模式），元测试
  `conformance` › `replay fails the run when a model request has no recorded response`。
- 录制响应必须全部消费：harness 既有语义，元测试
  `conformance` › `replay fails teardown when a recorded response is left unconsumed`。
- fixture 缺失直接抛错：元测试 `conformance` › `replay refuses to start against a missing fixture`。
- `CODEX_HOME` ambient override 隔离：`codexAgentHostE2E.integrationTest.ts` ›
  `an ambient CODEX_HOME override does not leak into the agent host or provider processes`
  （capture：`codex-an-ambient-codex-home-override-does-not-leak-into-the-agent-host-or-provider-processes.yaml`）。
