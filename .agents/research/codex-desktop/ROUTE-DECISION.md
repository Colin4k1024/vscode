# D17 路线裁定与先验资产归并（ROUTE-DECISION）

> **结论（一句话）**：裁定 **本仓库 agentHost 为产品内核** + **移植 grok-code-product 流水线**（逐脚本评估见 §4）+ **以 grok-build ISS-057 为 UX 验收基准**（差距表见 §5，fallback 条件见 §6）——实测确认了 `00-FINDINGS.md` §7.2 的推荐，并**纠正了 §7.1 的一个关键事实错误**：grok-build 的 ACP 层连接的是 `xai-grok-pager`（x.ai Grok agent），**从不连接 codex**；它对 codex 的全部价值是「Codex App Desktop 交互基准（ISS-057）+ 少量模式参考」，不存在「另一条 codex 集成路线」。
>
> Issue：Colin4k1024/vscode#2（Part of #1）。调研日期：2026-09-19。基线：`origin/main` @ `cb9b6e568bd`。
>
> 路径约定：文中 `/Users/jiafan/...` 为调研机本地路径——`/Users/jiafan/Desktop/poc/vscode` = 本仓库任意工作副本，`/tmp/d17-grok-build` = grok-build 的浅 clone（可重新 clone 复现），换机时按此替换。
> 输入文档：`00-FINDINGS.md` §7、`LICENSE-CLEARANCE.md`（D10 已合并，其合规约束贯穿本文：copilot 硬阻断 → §4 脚本评估、MS Marketplace 禁入 → D15、clientInfo.name 必改 → D06）。

---

## 0. 验收对照速览

| # | 验收标准（issue #2） | 落点 | 状态 |
|---|---|---|---|
| 1 | ROUTE-DECISION.md 存在，三路线**实测**对比 + 明确裁定 | §2（命令与输出摘要）、§0 | 满足 |
| 2 | ACP vs app-server 能力覆盖矩阵（逐方法） | §3 | 满足 |
| 3 | grok-code-product 10 脚本逐个「直接复用/改造后复用/不用」+ 改造点 + 工作量 | §4 | 满足 |
| 4 | ISS-057 交互基准逐项「已满足/部分满足/缺失」+ 补齐代价 | §5 | 满足（2 项标注待 D07 实测） |
| 5 | fallback 触发条件明确 | §6 | 满足 |
| 6 | 归档决定列出 + 明确标注需授权 | §7 | 满足（本 PR 不执行任何归档） |
| 7 | D06/D07/D09 Issue 描述按裁定更新 | §8 + 本 PR 附带的 `gh issue edit`（#8/#9/#11，只追加不删改） | 满足 |
| 8 | grok-code-extension 去留有结论 | §9 | 满足 |

---

## 1. 三条路线的实测身份（先纠正事实，再谈对比）

| 仓库 | 本次实测确认的身份 | 关键证据（2026-09-19） |
|---|---|---|
| **本仓库**（Colin4k1024/vscode） | microsoft/vscode fork @ `origin/main cb9b6e568bd`（1.139.0 系），**原生 in-tree Codex 集成**：spawn `codex app-server`，stdio JSON-RPC | §2.1 实测输出：app-server 进程从 `node_modules/@openai/codex-darwin-arm64/.../bin/codex` 拉起，`account/read` 返回 `accountType=chatgpt planType=plus` |
| **grok-build**（Colin4k1024/grok-build） | **xai-org/grok-build 的 fork**（GitHub `fork=true, parent=xai-org/grok-build`；README 自述"SpaceXAI's terminal-based AI coding agent…synced from the SpaceXAI monorepo"），HEAD `7233841825d`，**2026-09-19 仍有 push**，151 issues 全关。其 Electron 壳（`electron/` + `src/` React/Tailwind/Vite）是 Colin4k1024 的增量，以 Codex App Desktop 为 UX 复刻目标（ISS-057），**agent 后端是 `xai-grok-pager`（Grok），不是 codex** | `electron/acp-session.ts:190` 是 electron 层唯一的 agent spawn：`spawn(bin, ["agent", "stdio"])`，`bin = resolveAgentBinary()` 解析到 `xai-grok-pager`（acp-session.ts:34-55）；全仓库 grep `codex` 在 electron/ 仅命中注释与 `~/.codex/skills` 扫描路径（main.ts:707） |
| **grok-code-product**（Colin4k1024/grok-code-product） | Code OSS **瘦发行 overlay 构建系统**（非 fork，独立仓库），`UPSTREAM_COMMIT=138f619c86f1`（1.96 时代），`VERSION 0.1.0`，最后 push 2026-08-12；`patches/` 目录**实际为空**（仅 `.gitkeep`）——overlay 路线当前以 0 patch 运行 | `gh api repos/.../contents/patches` → 仅 `.gitkeep`；10 个脚本逐字审读（§4） |
| 附：**grok-code-extension** | VS Code 扩展（`engines.vscode ^1.96.0`，ACP，publisher 残留 `xai`），为 grok-code-product 瘦发行服务的内置扩展 | `gh api .../contents/package.json`；去留见 §9 |

**对 `00-FINDINGS.md` §7.1 的纠正**：原文把 grok-build 列为「与 Codex 的接法：ACP（较薄）」并放入三条 codex 集成路线对比。实测表明 grok-build 的 ACP 客户端连接 Grok agent，**没有任何 codex agent 连接/spawn 代码**（全仓库 grep `app-server|app_server` = 0 命中）。它对 codex 仅有两处非连接性感知：`main.ts:707` 扫描 `~/.codex/skills` 供 composer `$` 触发，以及 `crates/codegen/xai-grok-foreign-sessions` 的**只读 codex rollout 导入器**（CodexCli/VsCode/Atlas/ChatGpt 四源 + zstd 解压）——后者反而是 D03/D04 可借鉴的资产（跨产品会话导入的模式），不应被绝对化表述掩盖。因此：

- 「ACP vs app-server 能力矩阵」（§3）的真实语义是**协议层对比**——回答「若回退 grok-build 路线并把 codex 接进去，ACP 这一薄协议层要付出什么代价」，而不是「两条已有 codex 集成的优劣」。codex 官方不提供 ACP server；把 codex 接入 grok-build 需要二选一：(a) 写 codex→ACP 适配层（协议折叠，丢能力，§3 逐项列损）；(b) 把 `acp-session.ts` 重写为 app-server 客户端（等于重写本仓库 codex 集成层的前身（26 个手写文件共 ~15k LOC，其中 `codexAgent.ts` 8,427 行；另有 828 个生成协议类型 / 13,550 行），并放弃 103 replay capture 的回归资产）。
- grok-build 的可复用资产是**UX 层**（ISS-057 基准 + 已完成的 11 个交互子任务）与**工程模式**（keychain auth / detach / journal / TPN 格式），与 codex 协议层无关。

---

## 2. 实测对比（验收 1：附命令与输出摘要，不是推断）

### 2.1 本仓库 agentHost 路线：Agents 窗口 + codex app-server 全链路实测

**环境**：主工作区（D01 已 bootstrap：node_modules/out/.build 齐备，Node 24 于 `.build/node24/bin`）。
**命令**（2026-09-19 20:41，新一轮采集，未复用 BOOTSTRAP.md §6d 旧证据）：

```bash
cd /Users/jiafan/Desktop/poc/vscode
export PATH="$PWD/.build/node24/bin:$PATH"
unset ELECTRON_RUN_AS_NODE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
.agents/skills/launch/scripts/launch.sh --agents --session-title d17-route
```

**输出 JSON（摘要）**：`exit 0`，`agents: true`，`totalMs 1556`（profile 156 + preLaunch 695 + CDP 705），`runDir /tmp/code-oss-dev-20260919-204156-62260-S7psTW`，四个独立调试端口（cdp 63020 / extHost 63021 / main 63022 / agentHost 63023）。

**agenthost.log 关键行**（`grep -iE "codex|Registering agent provider"` 原样摘录）：

```
20:42:01.158 [info] Registering agent provider: copilotcli
20:42:01.158 [info] Registering agent provider: claude
20:42:01.158 [info] Registering agent provider: codex
20:42:01.158 [info] [Codex] starting one-off startup account probe
20:42:01.158 [info] [Codex] resolving SDK from repo node_modules (dev fallback): /Users/jiafan/Desktop/poc/vscode
20:42:01.158 [info] [CodexProxyService] listening on http://127.0.0.1:63032
20:42:01.158 [info] [Codex] spawning app-server from /Users/jiafan/Desktop/poc/vscode/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex
20:42:01.480 [info] [CodexClient warn] dropping unhandled notification: remoteControl/status/changed
20:42:01.492 [info] [Codex] account/read accountType=chatgpt requiresOpenaiAuth=true planType=plus
20:42:03.298 [info] [Codex] stopped one-off startup account probe
```

**结论要点**：
1. Codex provider 注册成功且走 **OpenAI 原生认证**（`account/read` 探测，读 `~/.codex` 凭据，**只做 account/read，未发起任何付费 turn**，探测 2.1s 内完成并回收子进程）。
2. app-server 二进制从仓库 `node_modules` vendored 路径拉起——D02 的供给机制在 dev 形态下已工作。
3. 渲染层确认：`window1/renderer.log` 出现 `[sessions welcome] Showing sign-in dialog`——**已知 G6 GitHub 登录墙仍在**（修复归 D04/#6），数据链路本身通（实测：`find ~/.codex/sessions -name 'rollout*' | wc -l` = **174 个 rollout 文件**（分布于 62 个日期目录、其中 61 个含 rollout；`find ~/.codex/sessions -type d | wc -l` = 72 含根/月份层目录；另有 12 个 archived）、`ls ~/.codex/skills | wc -l` = **218 项**可被发现）。
4. 测后清理：`kill <pid>` 后 `pgrep -f "codex app-server"` **无孤儿**，runDir 已删除。

### 2.2 grok-build：静态审计（如实标注：未跑起）

**未跑起的原因（如实声明）**：完整运行需 (a) 编译 x.ai Rust workspace（`Cargo.lock` 15,892 行依赖图，`crates/{build,codegen,common}`，CI 脚本显示还需 protoc / seccomp filter 等平台件）；(b) x.ai API 凭据（本机没有，且本任务禁止真实付费 LLM 调用）。因此按预案执行**双侧静态审计**：Electron 客户端（`electron/acp-session.ts`，630 行逐行读）+ Rust agent 端（`crates/codegen/xai-grok-pager/src/app/acp_handler/` 15 个 .rs 模块抽查 dispatch，含 mod.rs；连 tests/mod.rs 共 16）。

**命令与产物**：

```bash
git clone --depth 50 https://github.com/Colin4k1024/grok-build.git /tmp/d17-grok-build   # HEAD 7233841825d (2026-09-19)
wc -l electron/acp-session.ts        # 630
grep -rn "spawn(" electron/*.ts       # 唯一 agent spawn: acp-session.ts:190 spawn(bin, ["agent","stdio"])
gh issue view 105 --repo Colin4k1024/grok-build    # ISS-057 [EPIC]（正文见 §5）
for i in 106..116; gh issue view $i --json state   # 11 个子 issue 全部 CLOSED
```

**客户端能力面（`acp-session.ts` 逐方法）**：`initialize`（protocolVersion 1，声明 `fs.readTextFile/writeTextFile`，`terminal: false`）、`authenticate`、`session/new`、`session/load`（恢复）、`session/prompt`（含 `_meta.promptId/screenMode`）、`session/set_model`、`session/cancel`；服务端→客户端请求处理：`session/request_permission`（唯一审批通道）、`x.ai/ask_user_question`（x.ai 私有扩展，elicitation 等价物）、`fs/read_text_file`、`fs/write_text_file`（jail 到会话根）；通知：`session/update`（`agent_message_chunk/agent_thought_chunk/user_message_chunk(replay)/tool_call/tool_call_update/plan/usage_update`）+ `x.ai/session_notification`（auto_compact 四态）。MCP 以 `mcpServers: []` 传参（客户端不管理 MCP 会话，配置写 `~/.grok/config.toml` 由 agent 端自连，`mcp-config.ts`）。
**Rust 端 dispatch（`acp_handler/mod.rs`）**：`session/update` 为主通知通道；扩展请求入口共 3 个（`mod.rs:700-704`：`x.ai/ask_user_question`、`x.ai/exit_plan_mode`、`x.ai/mcp/elicit`），另有扩展通知 `x.ai/mcp/elicit_complete`（:626）；另有 background/evolution/follow_ups/interactions/mcp/permissions/prompt_origin/queue/routing/session_notification/settings/subagent_*/workflow_ingest 等 14 个 .rs 模块（mod.rs 之外；含 mod.rs 共 15，连 tests/mod.rs 共 16）（agent 内部功能，多数不经 ACP 暴露）。

### 2.3 grok-code-product：脚本全量拉取审读

```bash
for s in fetch-upstream apply-patches build package bundle-agent generate-icons \
         generate-sbom check-update sync-upstream verify-beta-gates; do
  gh api "repos/Colin4k1024/grok-code-product/contents/scripts/$s.sh" -q .content | base64 -d > $s.sh
done   # 10/10 拉取成功，共 594 行，逐字审读 → §4
```

---

## 3. ACP vs app-server 能力覆盖矩阵（验收 2：逐方法）

列说明：**app-server（本仓库）** = `codex app-server` v2 协议提供且 `codexAgent.ts` 实际接线的方法（证据 = `grep -oE "'[a-zA-Z]+/[a-zA-Z/]+'" codexAgent.ts` 提取的 67 个方法名 + 处理函数行号）；**ACP 标准** = Zed Agent Client Protocol v1 的协议面（以 grok-build 客户端声明的 protocolVersion 1 为准）；**grok-build 实现** = `acp-session.ts` 实际代码（§2.2）。

### 3.1 审批（7 类 vs 1 类）

| # | app-server 审批类（本仓库接线证据） | ACP 标准 | grok-build 实现 | 回退路线的损失 |
|---|---|---|---|---|
| 1 | `item/commandExecution/requestApproval` kind=`command`（codexAgent.ts:2643） | 无对应细分 | 折叠进 `session/request_permission` | writeStdin 与 command 不可区分 |
| 2 | `item/commandExecution/requestApproval` kind=`writeStdin`（协议类型 `CommandExecutionApprovalKind`） | 无 | 同上 | 同上 |
| 3 | `item/fileChange/requestApproval`（codexAgent.ts:2651；决策 `accept/acceptForSession/decline/cancel`） | 无 | 同上 | 「本会话内全部接受」语义靠 ACP `allow_always` 近似，patch 粒度信息丢失 |
| 4 | `item/permissions/requestApproval`（网络/文件系统权限升级；`_requestItemApproval` codexAgent.ts:3808） | 无 | 同上 | 权限升级与命令审批混为一谈 |
| 5 | `item/tool/requestUserInput`（模型 ask_user；codexAgent.ts:2671） | 无 | `x.ai/ask_user_question`（**私有扩展**，非 ACP 标准） | codex 无此扩展，需自造等价物 |
| 6 | `mcpServer/elicitation/request`（MCP server 发起；codexAgent.ts:2679，mapper `codexElicitationMapper.ts`） | 无 | agent 端存在私有 `x.ai/mcp/elicit`（+ `elicit_complete` 通知），但 Electron 客户端**未实现**（`acp-session.ts:494-501` 对未声明方法返回 -32601） | 回退路线仍需自建客户端侧等价物（私有扩展不能跨 agent 复用） |
| 7 | `item/autoApprovalReview/started/completed` + `thread/approveGuardianDeniedAction`（Guardian 自动审批复核与 deny override；codexAgent.ts:4008） | 无 | 无 | 完全缺失 |

### 3.2 会话生命周期与恢复

| 能力 | app-server（本仓库） | ACP 标准 / grok-build | 结论 |
|---|---|---|---|
| 新会话 | `thread/start` + `thread/started`（含 `dynamicTools` 注入位） | `session/new` | 等价 |
| 恢复 | `thread/resume`（原生）+ rollout 文件发现（`codexRolloutMetadata.ts`；实测 `find ~/.codex/sessions -name 'rollout*' | wc -l` = 174 个 rollout 文件（62 个日期目录，61 个含 rollout；find -type d = 72 含根/月份层）） | `session/load` + `_meta.isReplay` 转录重放（客户端 `journal.ts`/`transcript-store.ts` 自持久化，ISS-057 前置工作） | 形态不同：app-server 恢复是协议原生；ACP 靠客户端自建 journal 模拟 |
| fork | `thread/fork`（协议原生，`codexForkPlan.ts` 决定分支边界） | 无；grok-build 的 fork 是客户端复制转录（ISS-079） | ACP 亏 |
| side-chat / peer chat | `multipleChats: { fork: true, sideChat: true }`（codexAgent.ts:4156）+ peer-chat 目录 | 无 | ACP 亏 |
| checkpoint / 回滚 | `thread/revert` + `thread/rollback` + `IAgentHostCheckpointService` 基线快照（codexAgent.ts:5852） | 无（grok-build 仅 diff 审阅 `git-review.ts`） | ACP 亏 |
| 归档 | `thread/archive` / `thread/unarchive` | 无（客户端本地状态） | 实现层可补 |
| 压缩 | `thread/compact/start` + `thread/compacted` | `session/prompt "/compact"` + `x.ai/session_notification` auto_compact 四态（私有扩展） | 近似等价 |
| turn 操控 | `turn/start/started/completed/interrupt/steer` | `session/prompt` / `session/cancel`（无 steer；grok 靠 `_meta.promptId` + `prompt_ack.rs` 自制排队） | steer（运行中注入/排队）需自建 |
| 目标/待办 | `thread/goal/updated/cleared`、`thread/tokenUsage/updated`、`thread/turns/list` | `plan` update、`usage_update` | 近似 |

### 3.3 生态面（MCP / skills / hooks / plugins / tools）

| 能力 | app-server（本仓库） | grok-build / ACP | 结论 |
|---|---|---|---|
| MCP | `mcpServer/tool/call`、`mcpServer/resource/read`、`mcpServer/startupStatus/updated`、`mcpServerStatus/list`、`config/mcpServer/reload`、VS Code 动态 OAuth 客户端注册（`codexMcpServers.ts:359`） | 客户端只编辑 `~/.grok/config.toml` 的 `[mcp_servers.*]` 表（`mcp-config.ts`），会话传 `mcpServers: []` | ACP 面 MCP 管理≈0 |
| skills | `skills/list`、`skills/changed`（变更订阅）、`skills/extraRoots/set`（调用点 `codexAgent.ts:7523`；实测 Agents 窗口发现 218 项 skills） | `main.ts:707 skills_list` 扫 4 目录（含 `~/.codex/skills`）仅为 composer `$` 触发提供名称+描述；无变更订阅 | 静态清单 vs 活生态 |
| hooks | `hooks/list`（`codexCustomizations.ts:402` 只读呈现） | 无 | ACP 亏 |
| plugins | 客户端插件同步+解析（`codexClientCustomizations.ts`） | 无 | ACP 亏 |
| server tools | `serverToolGroups` 能力声明 + `tools/call`（codexAgent.ts:216,76） | 无 | ACP 亏 |
| dynamic tools | `thread/start` 的 `dynamicTools`（codexAgent.ts:720/739，宿主工具按线程注入） | 无 | ACP 亏 |

### 3.4 账户与运维

| 能力 | app-server（本仓库） | grok-build / ACP | 结论 |
|---|---|---|---|
| 认证 | `account/login/start/completed`、`account/logout`、`account/read/updated`（实测：chatgpt/plus 探测 2.1s） | ACP `initialize→authenticate`（methodId）；密钥存 keychain（`auth.ts`，模式可借鉴） | 等价级 |
| rate limits | `account/rateLimits/read` + `account/rateLimits/updated`（结构化推送，codexAgent.ts:2608/3324） | 无；grok-build ISS-081 用**错误消息正则**猜 429（acp-session.ts:278-287） | ACP 亏（且脆） |
| 配置 | `config/read`、`config/batchWrite` | 无（直接改文件） | ACP 亏 |
| Guardian auto-review | `item/autoApprovalReview/*` + `codexGuardianReview.ts` | 无 | ACP 亏 |
| 遥测通道 | `agentHostTelemetry.log` / 未接线清单（`remoteControl/status/changed` 已知丢弃，D16 范围） | 无 | — |

**矩阵总结**：25 个能力族中，ACP（grok-build 实现面）等价/近似 8 个（会话生命周期主干、模型选择、compact、plan/usage、认证、审批的泛化单通道、转录重放式恢复、skills 静态清单），其中 2 个依赖 x.ai 私有扩展；其余 17 个（审批 7 类中的 5 类细分、elicitation、fork/side-chat/peer-chat、checkpoint/revert/rollback、rollout 原生恢复、steer、MCP 管理、skills 变更订阅、hooks、plugins、server/dynamic tools、rate limits、Guardian）**缺失或需协议外自建**。若走 grok-build 路线接 codex，要么接受能力折叠，要么重写协议客户端（≈重演 codex 集成层 26 文件 ~15k LOC（codexAgent.ts 单文件 8,427 行）+ 190 次上游提交的沉淀过程，且失去上游每周推进的免费维护）。

---

## 4. grok-code-product 10 脚本逐个评估（验收 3）

判定口径：**直接复用** = 逻辑不动、改名即用；**改造后复用** = 骨架/思路保留，列明改造点；**不用** = 路线不匹配或已被更强裁定取代。工作量单位：人日（PD），含自测。

| # | 脚本（行数） | 判定 | 改造点与理由 | 预估 |
|---|---|---|---|---|
| 1 | `fetch-upstream.sh`（36） | **不用** | 它服务 overlay 架构（拉 pristine 上游到 `upstream/vscode` 再打 overlay）。我们是 **in-tree fork**：上游同步 = `git merge upstream/microsoft`（D14 runbook 的事），pin 已由 D02 的 codex 供给机制 + git 历史承担。其「记录精确 hash 到 UPSTREAM_COMMIT」的小机制并入 D14 的 `UPSTREAM.md` 记录格式 | 0（D14 另立） |
| 2 | `apply-patches.sh`（56） | **改造后复用** | 保留「product mixin 应用器」半段：`product.json` 覆盖、`default-settings.json`、`branding/` 分平台拷贝（darwin/win32/linux/app 四目录）——正是 D06 需要的 mixin 落位逻辑。删掉 patches 半段（in-tree 路线 0 patch）；**必须修掉** `git apply 失败仅 WARNING 跳过` 的静默降级（改为硬失败），避免不可复现构建 | 0.5 PD |
| 3 | `build.sh`（44） | **改造后复用** | 骨架可用（平台/arch 自动探测 + `npm ci` + gulp 目标），但目标名是 1.96 时代的 `vscode-${platform}-${arch}`——需对 1.139 的 `build/` 入口逐一核验（我们的 D01 流程已验证过编译链，以 D01 实测命令为准重写入口段）；另需接入 Node 24 本地前缀（`.build/node24`）而非裸 `npm ci` | 1 PD |
| 4 | `package.sh`（86） | **改造后复用** | darwin 段的「找 .app → 塞 sidecar → hdiutil 出 DMG」流程可保留；改造点：(a) sidecar 换 codex SDK（先跑 §4-5 的 bundle 脚本）；(b) **补齐签名/公证**（codesign + notarytool，原脚本完全没有）；(c) win32/linux 段原是「skipped in dev」的空壳——改为接 VS Code 官方打包目标或 electron-builder；(d) 产物命名走 D06 品牌定案 | 3 PD |
| 5 | `bundle-agent.sh`（76） | **改造后复用**（→ `bundle-codex-sdk.sh`，即 D09 计划） | 保留「定位二进制 → 拷贝 → sha256 → 写 manifest」骨架。改造点：(a) 来源从 `command -v grok` 换成 `@openai/codex-<platform>` npm 包/tarball（D02 pin 机制）；(b) **补 Apache-2.0 义务**：随二进制拷贝 codex `LICENSE` + `NOTICE`（D10 §2 的硬义务，原脚本没有）；(c) manifest 结构沿用 `sidecars/manifest.json` 但加入版本号字段 | 1.5 PD |
| 6 | `generate-icons.sh`（54） | **直接复用** | rsvg-convert 多尺寸 PNG + `iconutil -c icns`（含 @2x）+ ImageMagick .ico——与 VS Code 各平台图标槽位（apply-patches 的四目录）严丝合缝。仅改输出文件名（D06 品牌定案后）；macOS 工具链（iconutil）本机已有 | 0.25 PD |
| 7 | `generate-sbom.sh`（68） | **不用** | **维持 D10 §14 裁定**：不移植本体。其 SBOM 是手写 3 组件（vscode MIT / agent Apache-2.0 / "See node_modules/*/package.json" 指针），粒度不满足 D09 验收；正确路线 = 以仓库 `cgmanifest.json` + `cglicenses.json` 为基线合并 node_modules/cargo 差集生成（D10 已给出 npm 1088 包 / cargo 1457 crate 的扫描配方） | 0（D09/D19 另立） |
| 8 | `check-update.sh`（27） | **改造后复用** | curl + python3 解析 update 服务（version/url/sha256 三字段）的客户端形态可保留；改造点：URL 换 D09 自托管端点、补 channel/平台矩阵与**签名校验**（只信 sha256 不够，需配合产物签名）；服务端是 D09 的另一工作项 | 1 PD（客户端侧） |
| 9 | `sync-upstream.sh`（68） | **改造后复用** | 6 步编排（fetch → 分支 → apply → 版本记录 → 冲突检查 → 总结）的骨架适合 D14 runbook 落地为脚本。改造点：(a) 步骤 3 从 apply-patches 换成 **fork merge + mixin 重放**（in-tree 语义）；(b) 其冲突检查（`git diff --diff-filter=U`）在 `git apply` 流程下**实际无效**（apply 不产生 unmerged 状态）——fork merge 流程下用 `git merge` 的真实冲突退出码替代；(c) 其 Step 6 Next steps 第 3 条的 `cd ../grok-code-extension && npm test` 删除（见 §9） | 2 PD |
| 10 | `verify-beta-gates.sh`（79） | **改造后复用** | 8 门校验的**模式**（逐门 pass/fail 汇总 + 非零退出）直接保留。检查项重写：(a) 门 1-3（grok-code-extension 编译/测试/lint）删除；(b) 新增 **copilot 剥离门**——产物不得含 `@vscode/copilot-api` / `@github/copilot`（D10 §5 的发布硬阻断，原脚本无）；(c) 新增 clientInfo.name ≠ `vscode_agent_host` 检查（D10 §3）；(d) 新增 gallery 非指向 MS Marketplace 检查（D10 §10）；(e) SBOM 门改为 cgmanifest 合并生成器可运行 | 1.5 PD |

**汇总**：直接复用 1 个（generate-icons）、改造后复用 7 个（约 10.75 PD）、不用 2 个（fetch-upstream、generate-sbom——分别被 D14 fork-merge 流程与 D10 cgmanifest 合并裁定取代）。合计移植工作量约 **11 人日**，远低于重写（每脚本重写约 2-3 PD × 10）。

---

## 5. ISS-057 交互基准 vs VS Code Agents 窗口差距表（验收 4）

基准来源：`gh issue view 105 --repo Colin4k1024/grok-build`（ISS-057 [EPIC] 正文），其 11 个子 issue（#106–#116）**全部 CLOSED**——即 grok-build 已按该基准完成 UX 重做，基准本身是被验证过的。对照面：本仓库 `src/vs/sessions/`（代码 + `LAYOUT.md` / `SESSIONS_LIST.md` 规格文档）+ §2.1 实测观察。

| # | ISS-057 基准项 | VS Code Agents 窗口现状（证据） | 判定 | 补齐代价 |
|---|---|---|---|---|
| 1 | 三栏布局（侧栏/线程/右面板） | 拓扑等价：Sidebar + Sessions Part + Editor/Auxiliary/Panel（`LAYOUT.md` 工作台拓扑；omits Activity/Status Bar 与 Codex 精神一致） | **已满足** | — |
| 2 | 无浏览器式 Tab，侧栏线程树为唯一切换入口 | Sessions Part 内含 chat-tab 呈现层（`chatGroupView.ts` "Chats" composite bar）；侧栏 Sessions list 亦可切换（`SESSIONS_LIST.md`） | **部分满足** | 低-中：chat-tab 是 session view 的呈现属性（规格明示），收敛为单入口是布局策略 + 默认值改动；但有正反面——多 session 并排（grid）是 VS Code 侧的超集能力，是否裁掉是产品决策 |
| 3 | Composer 内聚：项目选择器 | `projectBarPart.ts` + workspace 分组 + `sessionWorkspace.ts` | **已满足** | — |
| 4 | Composer 内聚：工作模式（local/worktree/cloud） | worktree 隔离有（`SessionConfigKey.Isolation='worktree'`，`baseAgentHostSessionsProvider.ts:177`）；cloud 有 remote provider（`providers/remoteAgentHost/` tunnel + cloudSandbox）；控件呈分散 | **部分满足** | 中：能力在，需收敛为 composer 单一「工作模式」控件（D07） |
| 5 | Composer 内聚：分支选择器 | `agentHostSessionBranchActions.ts`（分支 picker + Show Changes） | **已满足** | — |
| 6 | Composer 内聚：模型+effort 合一选择器 | 模型 picker 有（`agentHostAgentPicker.ts`）；effort 有 4 档（`CODEX_REASONING_EFFORTS = minimal/low/medium/high`，codexAgent.ts:206），但两者是分离控件，非 Codex 式「5.5 Extra High」合一呈现 | **部分满足** | 低：UI 合并呈现，协议层无缺口 |
| 7 | Composer 内聚：审批模式下拉（Full access / Ask before edits / Read only） | `agentHostCodexApprovalsPicker.ts` + permissions preset 体系（read-only/workspace-write/danger-full-access + approval policy，`codexSessionConfigKeys.ts`），且比 Codex 多「升级确认」防误触 | **已满足** | — |
| 8 | Composer 内聚：@ 加号添加文件（模糊搜索） | `agentHostInputCompletions.ts` 输入补全体系 | **已满足**（形态细节留 D07 实测） | — |
| 9 | `$` 技能 / `/` 命令 | 技能发现已工作（实测 218 项）+ `agentHostSkillButtons.ts`；slash 命令面待逐项对照 | **部分满足** | 低 |
| 10 | 运行中 Enter 注入 / Tab 排队下一条 | 协议层 `turn/steer` 已接线；默认键位行为是否等价 Codex 未实测 | **部分满足**（待 D07 实测） | 低 |
| 11 | 侧栏 Projects→threads 树 | Sessions list 有 workspace/date 分组 + custom groups + pinned + archived（`SESSIONS_LIST.md` 放置优先级模型）——「workspace 分组」即 Projects 语义 | **已满足** | — |
| 12 | 侧栏线程状态标注 Running/Waiting for approval/Completed | `sessionStatusIcon.ts` 存在；三态与 Codex 文案的一致性留 D07 核对 | **已满足**（细节待核对） | 低 |
| 13 | ⌘N 新线程 | `sessions/contrib/chat/browser/chat.contribution.ts:170` Ctrl/Cmd+N = New Session（有测试佐证） | **已满足** | — |
| 14 | ⌘K/⌘⇧P 命令菜单 | ⌘⇧P 命令面板为 VS Code 标准；⌘K 是 chord 前缀（文化差异） | **部分满足** | 低：键位重映射决策 |
| 15 | ⌘B 侧栏 / ⌘J 终端 | `layoutActions.ts` ToggleSidebar/TogglePanel（VS Code 标准键位同款） | **已满足** | — |
| 16 | ⌘O 添加项目 | workspace 添加路径存在；与 Codex「添加项目到 Projects」语义对齐度留 D07 | **部分满足** | 低 |
| 17 | ⌘G 搜索 | 未见同款全局线程搜索键位（VS Code 侧有 quick pick 搜索形态） | **待 D07 实测** | 低-中 |
| 18 | ⌘⇧[/] 线程间切换 | chat tabs 存在时可用编辑器 tab 键位体系；键位与 Codex 不同 | **部分满足** | 低 |
| 19 | 右侧五 tab：Files / Side chat / Review(diff) / Terminal / Browser | 能力全在：Auxiliary Bar（changes/files）、Panel（terminal）、Editor（browser/diff editors）、side chat（`multipleChats.sideChat`）、single-pane 模式把 aux 并入 editor tabs（`SINGLE_PANE_SCENARIOS.md`）——但不是 Codex 的「右栏固定五 tab」形态 | **部分满足** | 中：形态重组（布局策略层），能力无缺口 |
| 20 | Home = 大 composer + 最近线程 | `sessionsEmptyState.ts` 新会话空态 | **部分满足** | 低-中 |
| 21 | （负向基准）首启不得有不可跳过登录墙 | **缺失**：实测 `Showing sign-in dialog`（§2.1），`sessionsAuthGate.ts` 的 `ForceGitHubSignIn` 路径未解 | **缺失** | 已排 D04/#6（产品化 `allowSignedOutWhenUsable` 默认值） |
| 22 | 按住说话 / Ctrl+M 语音输入 | `newChatVoice.ts` + `voiceBridge.contribution.ts` + `voiceInputDecorations.ts`（`contrib/chat/browser/`）语音输入链路在 | **已满足**（交互细节留 D07 实测） | — |
| 23 | Triage / Review 收件箱 | changes 视图 + codeReview contrib 在（`contrib/changes/`、`contrib/codeReview/`）；「收件箱」聚合形态未呈现 | **部分满足** | 低-中：视图聚合呈现 |
| 24 | Settings 固定侧栏底部 | 设置入口经 VS Code 标准菜单体系；「固定在侧栏底部」的 Codex 式锚位未呈现 | **部分满足** | 低：布局策略 |
| 25 | 左栏 Plugins / Automations | 实测侧栏含 Plugins / Automations / MCP Servers / Skills / Chats / Customizations（§2.1 观察 + `automationsView.ts`） | **已满足** | — |
| 26 | ⌘⇧O（线程切换/新线程） | `sessionsActions.ts:1178` Ctrl/Cmd+Shift+O = "Go to Chat in Session" picker（多 chat 会话内跳转）；与 Codex 语义的贴合度待 D07 | **部分满足** | 低 |
| 27 | 窗口 chrome（ISS-068 / grok-build#115） | `LAYOUT.md:22` 明示 omits Activity Bar / Status Bar / Banner；自定义标题栏形态继承 VS Code `titleBarStyle` 体系，Codex 式 chrome 微调未做 | **部分满足** | 低：D06 品牌化时一并 |
| 28 | 移除常驻 StatusBar / ContextBar（ISS-064 / grok-build#112） | `LAYOUT.md:22`："The workbench omits the standard Activity Bar, Status Bar, and Banner" | **已满足** | — |

**汇总**（28 项全覆盖，含 ISS-057 EPIC 正文全部基准点；#10 归入待实测桶——其行内同时标注「部分满足」，两处不叠算）：已满足 12 / 部分满足 13 / 待实测 2（#10 Enter/Tab 排队、#17 ⌘G 搜索）/ 缺失 1（#21 登录墙，已有归属 issue D04）；12+13+2+1 = 28。**没有发现「能力层缺口」**——所有部分满足项均为呈现/布局/键位层的收敛工作，协议与数据链路层（§2.1、§3）完整。这是维持 agentHost 裁定的最强实证。

---

## 6. fallback 触发条件（验收 5）

裁定：**默认走 agentHost 路线；以下任一 gate 触发时，重开 D07 并正式评估回退 grok-build 路线**（届时工作 = 在 grok-build 中以 codex app-server 客户端替换 `acp-session.ts`，成本量级 = 重写 codex 集成层（26 文件 ~15k LOC，codexAgent.ts 单文件 8,427 行）+ 重建回归资产，应在回退评估时重新核价）。

| Gate | 触发条件（可量化） | 理由 |
|---|---|---|
| **F1 审批保真** | D07 落地后，§3.1 的 7 类审批中仍有 ≥2 类**无法在 Agents 窗口表达其区分语义**（如 writeStdin 与 command 混同、Guardian override 无入口），且单项修复预估 > 1 人周 | 审批是 agent desktop 的安全底线；语义折叠不可接受 |
| **F2 范式阻力** | §5 表中「部分满足」项在 D07 交付后仍有 ≥4 项无法收敛（含 #2 线程切换单入口或 #19 右栏五 tab 之一），或收敛方案需改动 workbench 核心布局（超出 sessions 层） | 范式差距本质是产品形态之争，改不动说明宿主不合适 |
| **F3 首启阻断** | D04 完成后，全新 profile 首启仍无法在无 GitHub/ChatGPT 登录的情况下进入可用 composer（§5 #21 复测失败） | 桌面 app 的第一分钟体验不可妥协 |
| **F4 维护断层**（前瞻） | 上游 microsoft/vscode 停止推进 agentHost（可执行判据：`git log --since=2.months --oneline -- src/vs/platform/agentHost | wc -l` < 5，或 ≥2 个 monthly release 无 agent 相关提交）或 sessions 架构发生破坏性重构使 rebase 成本连续两轮 > 5 人日 | in-tree 路线的核心红利是上游维护；红利消失则重估 |

**显式非触发**（避免误回退）：纯键位差异、图标/文案差异、单个小交互不一致——这些是 D07 的迭代项，不构成路线级 fallback。

---

## 7. 资产归并清单与归档决定（验收 6：归档均需用户显式授权，本 PR 不执行）

| 资产 | 处置 | 归并去向 | 是否涉及归档 |
|---|---|---|---|
| 本仓库 agentHost（`src/vs/platform/agentHost/node/codex/` 26 文件 + `src/vs/sessions/`） | **内核**（裁定） | — | 否 |
| grok-build ISS-057 基准（issue #105 正文 + 11 个已关子 issue） | **复用**（UX 验收基准） | D07/#9 的验收清单（本文 §5 即首版差距表） | 否 |
| grok-build 工程模式：`electron/auth.ts`（keychain 双写原子存储）、`detach.ts`（写锁多窗口会话分离）、`journal.ts`+`transcript-store.ts`（转录持久化/恢复）、`git-review.ts`（diff 审阅）、`THIRD-PARTY-NOTICES`（Rust crate TPN 格式） | **借鉴**（读代码取模式，不搬代码——不同代码库/许可证上下文） | D03（auth 模式）、D07（journal/detach 模式）、D09/D10（TPN 格式，D10 §14 已引用） | 否 |
| grok-code-product `scripts/` 10 脚本 | 1 直接复用 + 7 改造后复用 + 2 不用（§4） | D09/#11（build/package/bundle/icons/check-update/verify-gates/apply-mixin）、D14/#16（sync-upstream 骨架）、D06/#8（generate-icons、apply-mixin） | 否 |
| grok-code-product `product/` mixin 结构（product.json/branding/default-settings.json/extensions.json） | **复用**（目录形态） | D06/#8 的 mixin 模板 | 否 |
| grok-code-product `docs/enterprise.md` | **复用**（企业分发考量） | D10 已引用（LICENSE-CLEARANCE §14） | 否 |
| grok-build 仓库本体 | **保留**（fallback 路线 + UX 参考实现；**今日仍有 push**，151 issues 全关，是活跃资产） | — | 否（不归档） |
| grok-code-product 仓库本体 | **保留**（流水线模板参考；2026-08-12 后无 push，转低维护） | — | **可选归档——需用户显式授权**（若 D09 移植完成后确认不再参考） |
| grok-code-extension 仓库 | **建议归档**（§9） | — | **需用户显式授权后才执行** |

> 再次强调：**本 PR 未归档、未删除、未修改任何仓库**。上表所有「归档」均为建议，执行前需用户在 issue #2 下显式授权。

---

## 8. 对 D06 / D07 / D09 的输入（验收 7）

本 PR 附带以 `gh issue edit` 在 #8（D06）、#9（D07）、#11（D09）原描述**末尾追加**「D17 裁定输入」段（不删改原文）：

- **D06（#8）**：mixin 结构采纳 `product/` 目录形态；`generate-icons.sh` 直接复用（改名在品牌定案后）；`apply-patches.sh` 的 mixin 半段改造为 `apply-mixin` 逻辑且失败必须硬失败；品牌定案时同步改 `CLIENT_INFO.name`（D10 §3：不得沿用 `vscode_agent_host`）。
- **D07（#9）**：验收基准 = 本文 §5 差距表（28 项 + 判定 + 代价）；2 个「待实测」项（#10 键位行为、#17 ⌘G 搜索）在 D07 内闭环；决策门 = 本文 §6 的 F1–F4；D04 的登录墙（#21）列为 D07 验收前置。
- **D09（#11）**：脚本移植清单 = 本文 §4（约 11 人日）；`bundle-agent.sh` → `bundle-codex-sdk.sh`（含 LICENSE/NOTICE 拷贝义务）；`generate-sbom.sh` 不移植（维持 D10 §14 裁定：cgmanifest+cglicenses 合并生成）；`verify-beta-gates.sh` 重写检查项时**必须纳入 copilot 剥离门**（D10 §5 硬阻断）；`package.sh` 补签名/公证。

---

## 9. grok-code-extension 去留结论（验收 8）

**结论：建议归档（需用户显式授权后才执行；本 PR 不执行）。**

理由：
1. **技术冗余**：agentHost 是原生 in-tree provider（`Registering agent provider: codex`，§2.1 实测），不经扩展宿主；ACP 扩展能提供的会话面是 app-server 的小子集（§3 矩阵）。同一产品里两者并存 = 第四套重复资产的种子，正是 D17 要消除的。
2. **服务对象已被裁定淘汰**：grok-code-extension 是 grok-code-product 瘦发行（overlay + 内置扩展）路线的组件；内核裁定为 in-tree agentHost 后，该路线不再投入。
3. **维护停摆 + 品牌残留**：最后 push 2026-08-12；`package.json` `publisher: "xai"`、`engines.vscode ^1.96.0`（上游已到 1.139 系）——复活成本高于价值。
4. **保留的唯一场景**是未来做「在官方 VS Code 上可安装的轻量 codex/grok 扩展」——那是独立产品决策，不属于本 Epic；届时从 git 历史恢复即可（归档不删代码）。

---

## 10. 未完成项与诚实声明

**范围项偏离声明（issue #2 范围第 1 条）**：「在本仓库跑通一次 Codex 完整闭环」本轮**未执行**——实测止于启动 + `account/read` 探测（§2.1），未发起任何真实 turn（写文件/跑命令/审批/中断/恢复）。真正阻断：Agents 窗口存在不可跳过的 `ForceGitHubSignIn` 登录墙（`sessionsAuthGate.ts:59-68`，BOOTSTRAP.md §6f，修复归 D04/#6）；本轮亦未用 `chat.agentHost.allowSignedOutWhenUsable` 临时绕过 + 真实 turn 补证据，因为真实 turn 消耗付费额度且未获此授权。完整闭环归 D03/D04 联合冒烟验收（#5/#6 验收 1），本节显式登记，不以探测冒充闭环。

1. **grok-build 未做运行时实测**（§2.2 已声明原因：Rust workspace 编译重 + 无 x.ai 凭据 + 禁止付费调用）。能力矩阵基于双侧静态审读（客户端 630 行逐行 + Rust dispatch 抽查）。若后续需要运行时复核（例如 fallback 评估触发时），需用户授权 x.ai 凭据。
2. **§5 有 2 项标注「待 D07 实测」**（#10 Enter/Tab 排队键位、#17 ⌘G 搜索），非本次遗漏——其判定依赖 D07 的交互实测轮，已在 D07 输入中列为该 issue 的闭环项。
3. **§2.1 实测为 dev 形态**（dev fallback SDK 解析 + 本机 `~/.codex` 凭据）；出厂形态（`product.json.agentSdks` 注册，G2/D02/D09 范围）不在本次验证内。
4. 00-FINDINGS.md §7.1 的「grok-build 以 ACP 连 codex」表述与实测不符（§1 已纠正）；`00-FINDINGS.md` 在本 PR 中仅在 §7.1 追加了勘误横幅（指向本文），原文其余部分未删改（历史调研文档，以本文为准）。

## 附：复现配方

```bash
# A. agentHost 实测（主工作区）
cd /Users/jiafan/Desktop/poc/vscode && export PATH="$PWD/.build/node24/bin:$PATH" \
  && unset ELECTRON_RUN_AS_NODE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS \
  && .agents/skills/launch/scripts/launch.sh --agents --session-title d17-route
RUN=<输出 JSON 的 runDir>; cat $RUN/user-data/logs/*/agenthost.log | grep -iE "codex|Registering agent provider"

# B. grok-build 静态审计
git clone --depth 50 https://github.com/Colin4k1024/grok-build.git /tmp/d17-grok-build
sed -n '1,120p' /tmp/d17-grok-build/electron/acp-session.ts          # 唯一 agent spawn: :190
gh issue view 105 --repo Colin4k1024/grok-build                       # ISS-057 基准

# C. 脚本拉取
for s in fetch-upstream apply-patches build package bundle-agent generate-icons generate-sbom check-update sync-upstream verify-beta-gates; do \
  gh api "repos/Colin4k1024/grok-code-product/contents/scripts/$s.sh" -q .content | base64 -d; done

# 能力面提取（本仓库）
grep -oE "'[a-zA-Z]+/[a-zA-Z/]+'" src/vs/platform/agentHost/node/codex/codexAgent.ts | sort -u
```
