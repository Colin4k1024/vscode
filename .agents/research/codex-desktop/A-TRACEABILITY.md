# A 段双向追溯表（D12 / Issue #14）

`01-ACCEPTANCE-CORE.md` A 段每一行 → 可执行断言位置。层级说明：`unit`（`npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"`，CI 由 `codex-desktop-baseline.yml` 的 agent-host 单测 job 覆盖）；`live`/`replay(e2e)` 超出本 Issue 的离线范围，标注其归属。

## A1. Turn 生命周期

| # | 不变量 | 断言位置 | 层级 |
|---|--------|----------|------|
| A1.1 | `turn/start` 响应 ≠ 运行起点 | `codexTurnLifecycleInvariants.test.ts` → `A1.1 response-is-not-start`（wire 级：result 不触发 `turn/started` 处理器；reducer 级：无 `ChatTurnStarted` 不开 turn） | unit |
| A1.2 | 一个 thread 至多一个 active turn | 同文件 `A1.2 single-active-turn`（并发第二个 `turn/start` 被拒 → 请求 reject，无第二个 active turn；reducer `activeTurn` 标量兜底） | unit；live 变体属 D11 e2e |
| A1.3 | 终态事件不可丢失（背压下亦然） | 同文件 `A1.3 terminal-not-lost`（单 chunk 402 条通知全量按序送达、终态最后；孤儿 tool call 在 `mapTurnCompleted` 强制收尾） | unit；replay 背压变体属 D11 |
| A1.4 | interrupt → `turn/completed`(interrupted) → AHP cancelled，无分裂 | 同文件 `A1.4 interrupt-consistency`（`ChatTurnCancelled`、`currentTurnId` 清空、open tool calls 强制 cancelled） | unit；live 轮询变体属 D11 |
| A1.5 | 状态转移单调，转移表穷举 | 同文件 `A1.5 transition-table exhaustion`（3 终态 × 合法路径；非法：无 started 的 completed、异 id completed、未知 item completed、终态后活动不回退、二次终态幂等；序列性质断言） | unit |

## A2. Item 生命周期

| # | 不变量 | 断言位置 | 层级 |
|---|--------|----------|------|
| A2.1 | `item/started` ↔ `item/completed` 配对 | `codexCaptureInvariantScanner.test.ts` → `A2.1 capture pairing`（全部 103 个 codex capture + 非 codex capture：tool_use ↔ tool_result 配对，未配对只允许落在最终 exchange 的清理窗口）+ `AHP traffic snapshot pairing`（全部 54 个 AHP 快照：toolCallStart/Complete 配对） | unit（离线扫描）；live replay 属 D11 |
| A2.2 | 终态不被 `inProgress` 回退 | `codexTurnLifecycleInvariants.test.ts` → `A2.2 no-status-regression`（同 id 重复 started 分配新 toolCallId，原 completed 不变；declined 的 `error.code='denied'` 保留） | unit |
| A2.3 | fileChange diff 与 changeset 聚合一致 | 既有 e2e `codex-session-changeset-aggregates-provider-edits-from-default-and-peer-chats.yaml`（D11 套件） | replay(e2e) |
| A2.4 | delta 拼接 == completed 全文 | 既有 e2e `codex-preserves-a-fenced-multiline-markdown-response.yaml`（D11 套件） | replay(e2e) |

## A3. 审批闭环

| # | 不变量 | 断言位置 | 层级 |
|---|--------|----------|------|
| A3.1 | turn 终态后 pending 为空 | `codexApprovalInvariants.test.ts` → `A3.1 pendingRequestRegistry turn-terminal drain`（denyAll/rejectAll/registerAndFire 原子性/重复 key 取消）；`codexCaptureInvariantScanner.test.ts` AHP 扫描（终态时无悬挂 confirmation）；既有 `test/common/pendingRequestRegistry.test.ts` | unit + 离线扫描；live 变体属 D11 |
| A3.2 | 禁止 fail-open | `codexApprovalInvariants.test.ts` → `A3.2 no-fail-open`（agent 级：不响应 → 永远挂起、无 item/completed、无副作用、无终态；wire 级：parked 请求零字节应答直到 handler 答复；显式 decline 路径） | unit |
| A3.3 | 畸形 decision 归一 decline | 同文件 `A3.3 decision normalization`（4 合法透传 + 9 类畸形输入穷举 → decline；unknown thread/item 不落 registry） | unit |
| A3.4 | `acceptForSession` 不跨 session 泄漏 | `acceptedForSession` memo 为 per-`ICodexSession` 字段（`codexAgent.ts`）；live 双 session 用例属 D11 e2e（`AGENT_HOST_REAL_CODEX=1`） | live(e2e) |
| A3.5 | writeStdin 审批不改变父 commandExecution 状态 | 同文件 `A3.5 writeStdin isolation`（guardian 审批铸造全新 toolCallId，父 item 追踪与终态零改动） | unit |
| A3.6 | 权限授予子集语义 + 配置 narrowing | 同文件 `A3.6 permissions subset semantics`（accept 恰好授予所请求、decline/cancel 授予空、scope:'session' 仅 acceptForSession、null 项不可授予、Agent Merge 禁网络提权；`resolveCodexPermissions`/`narrowAdditionalDirectories` 穷举） | unit |
| A3.7 | `isBlocking:true` 无限等待，不读 `autoResolutionMs` | 同文件 `A3.7 blocking user input`（`autoResolutionMs:1` 仍挂起至显式应答；isBlocking:false 同样无自动应答；无 active turn 立即空答）+ 静态断言 `static: autoResolutionMs is never read outside the generated protocol types`（扫描 agentHost 全部实现源码，字段仅允许出现在 generated 协议类型与测试中） | unit |
| A3.8 | elicitation ≠ 权限授予 | 同文件 `A3.8 elicitation ≠ permission`（accept+content 不触碰 pendingCommandApprovals/acceptedForSession/confirmation 卡；unknown thread → decline） | unit |

## A4. 编排不变量 I1–I8

| # | 不变量 | 断言位置 | 类型 |
|---|--------|----------|------|
| I1 | `providerData` 对 host 不透明 | `agentHostOrchestrationGuards.test.ts` → `I1`（静态：agentService/agentHostStateManager 无 `JSON.parse(providerData)`、无 `.providerData.x` / `?.x` / `[k]` 访问——含可选链与索引绕过，注释/字符串剥离防误报，守卫自带 self-check；动态：`registerRestoredChatSummary` blob 字节级 round-trip 进 resolver） | 静态 + unit |
| I2 | session URI ≠ chat channel URI | 同文件 `I2`（build/parse 往返；500 例 property-based 随机 session URI 永不被判为 chat channel 且往返恒等；`ahp-chat` scheme 碰撞向量——保留 scheme 语义、嵌套路径不误判、双层包裹逐层解包；垃圾输入拒识） | unit |
| I3 | 不假设 `sessionId === threadId` | 同文件 `I3`（绑定缺失 → `undefined` 拒绝；绑定与 URI 拼写不同 → 绑定胜）；既有 `codexAgent.test.ts` `_resolveConversationSession` 系列 | unit |
| I4 | 单一 catalog 入口 + DR1 顺序 | 同文件 `I4`（`_chatEntries` 写入点 == baseline 集合 `d12-i4-chat-entries-writers.json`——覆盖 set/delete/clear、索引写与整体重赋值，注释剥离防误报，守卫自带 self-check，别名写为已知边界见源码注释；`_initializeProvider` 内 spawn 序监听先于 AgentSideEffects 的源码序断言） | 静态 |
| I5 | 中央 catalog 唯一真源 | 既有：`agentService.test.ts`（`central list uses eligible catalogs…` L5332、`restart restores central peer membership…` L17120 等）、`agentHostPeerChatStore.test.ts` authoritative 系列 | unit（既有覆盖） |
| I6 | 经 `IAgentHostProviderService` 路由 | 同文件 `I6`（codex/claude/copilot 切片禁止引用 `_sessionToProvider` / 直接 import `agentHostProviderService.js`） | 静态 |
| I7 | backingSession 不进 `listSessions`；`_markChatBacking` 失败 → 进程内抑制 | 既有：`agentService.test.ts` L15306（backing 被过滤且跨重启保持）、L15518（一次写失败仍创建成功并持久化）、L15570（持续失败 → `_unpersistedChatBackings` 进程内抑制）、L17527 | unit（既有覆盖） |
| I8 | provider 不自行推导 host 事实 | 同文件 `I8` + baseline `d12-i8-codex-host-state-imports.json`（当前为空——AGENTS.md §8 自述的技术债已清偿，新增引用即败，baseline 只准缩小） | 静态 + baseline |

## A5. Codex 身份不变量

| # | 不变量 | 断言位置 | 层级 |
|---|--------|----------|------|
| A5.1 | `_sessionIdByChatUri` 精确路由 | `codexIdentityInvariants.test.ts` → `A5.1`（未绑定拒绝；chatA 绑定不为 chatB 解析） | unit |
| A5.2 | 未注册 threadId 回调丢弃不崩溃 | 同文件 `A5.2`（`_dispatchItemCompleted` 未知 thread → 无异常、零 fire） | unit |
| A5.3 | 恢复保留已存模型；缺失则等同 provider 首个可用 | 同文件 `A5.3`（在目录→原样；缺失→同 provider fallback；排队中的 model discovery 及其后续 refresh 均被 await） | unit |
| A5.4 | 绝不跨计费 provider | 同文件 `A5.4`（异 provider 同名模型不被采用，保留原选择） | unit |
| A5.5 | 无可用模型保留选择；从未选择才用全局默认 | 同文件 `A5.5` | unit |
| A5.6 | `thread/resume` 必带 model + modelProvider | 同文件 `A5.6`（`buildCodexResumeParams` 穷举断言） | unit |
| A5.7 | 元数据读不 resume、不抢 writer lock | live 变体（另一 codex 客户端打开同 thread）属 D11 e2e | live(e2e) |
| A5.8 | 显式切换 provider 仅下次 send reload，同 threadId | 同文件 `A5.8`（静态：resume 块仅发 `thread/resume`、复用同一 `threadId`、不含 `thread/start`）；既有 `codexModelSelection.test.ts` id 往返 | unit（静态） |
| A5.9 | `codexProviderSwitch` 只在 turn/start 被接受后计数 | 同文件 `A5.9`（静态：唯一调用点位于 `await turn/start` 之后、且 gate 于同 thread；动态：同 provider/未知 provider 不计数）；既有 `codexProviderSwitchTelemetry.test.ts`（配额分桶/省略语义） | unit + 静态 |

## CI 门禁

全部新断言均为 `src/vs/platform/agentHost/test/node/**/*.test.ts`，经 `npm run gulp transpile-client-esbuild` 进入 `out/` 后被 `codex-desktop-baseline.yml` 的 "Agent Host unit tests" job（`--runGlob "vs/platform/agentHost/test/node/**/*.test.js"`）自动纳入，无需新增 workflow 步骤。
