# D07 形态裁定 — Agents 窗口作为默认桌面形态

> **结论（一句话）**：主形态 = **Agents 窗口（agent-first）**。自本裁定起，裸启动（无文件/文件夹参数、无特殊模式）默认进入 Agents 窗口，无需 `--agents`；常规 workbench 窗口能力完整保留，经显式入口（路径参数、`--new-window`、深链、`agents.returnToVSCodeEditor` 反向为 `workbench.action.openAgentsWindow`）可达。
>
> Issue：Colin4k1024/vscode#9（Part of #1）。基线：`origin/main` @ `76b0fdfe061`（含 D02/D03/D04/D17）。裁定日期：2026-09-20。依据：D17 路线裁定（`ROUTE-DECISION.md`）、ISS-057 基准（§2）、fallback 决策门（§3）。

---

## 1. 两种入口能力差异表（验收 1）

对照面：`src/vs/sessions/`（29 个 contrib 目录）+ `src/vs/sessions/LAYOUT.md` 拓扑声明 vs 常规 workbench。

| 能力域 | Agents 窗口 | 常规窗口 | 分类 |
|---|---|---|---|
| Sessions Part / 侧栏 Sessions list / picker / composer 体系（`contrib/sessions/`） | ✅ | ❌ | **Agents-only** |
| Agent provider 集成（`contrib/providers/`：localAgentHost + remoteAgentHost/tunnel/cloudSandbox） | ✅ | 部分（经 `agentSessions` 视图 + `preferAgentHost` 复用同一 agentHost 内核） | **Agents-only（形态）/ 共有（内核）** |
| Automations 视图（`contrib/automations/`） | ✅ | ❌ | **Agents-only** |
| 首启 onboarding / 导览（`contrib/onboardingTours/`、`sessionsSetUpService.ts`） | ✅ | ❌ | **Agents-only** |
| 会话级 code review / changes 收件箱（`contrib/codeReview/`、`contrib/changes/`） | ✅ | 部分（diff editor 共有，收件箱聚合形态无） | **Agents-only（形态）** |
| accountMenu / agentFeedback / blockedSessions / sessionInputBanners / aiCustomizationTreeView / applyCommitsToParentRepo / tunnelHost / aquarium / chatDebug / customViewTest | ✅ | ❌ | **Agents-only** |
| Chat widget / composer / queue-steer / 语音输入（`contrib/chat/` 复用 `workbench/contrib/chat`） | ✅ | ✅（sidebar chat） | **共有** |
| Editor / Terminal / Files / fileTreeView / Search / Workspace / Layout / Configuration / GitHub / browserView | ✅ | ✅ | **共有** |
| 扩展宿主 | 裁剪：`sessionsWindowAllowedExtensions` 白名单 + builtin 能力审核（`extensionEnablementService.ts` `_isDisabledBySessionsWindow`） | 完整 | **常规-only（完整生态）** |
| Activity Bar / Status Bar / Banner | ❌（`LAYOUT.md` 明示 omit） | ✅ | **常规-only** |
| Explorer / SCM / Debug / Notebook 等完整视图体系 | ❌（裁剪） | ✅ | **常规-only** |

**结论**：两种入口共享同一 agentHost 内核与 chat composer 栈；Agents 窗口多出会话管理/自动化/onboarding 形态层，常规窗口多出完整编辑器生态。能力面不存在「Agents 窗口做不到而产品必须」的内核缺口。

---

## 2. ISS-057 交互基准差距表（验收 2）

基准 = `ROUTE-DECISION.md` §5 的 28 项判定；本 Issue 实测闭环其中 2 项「待实测」（#10、#17），其余沿用 D17 判定并在此复核证据。

| # | 基准项 | D07 判定 | 证据（D07 新增加粗） |
|---|---|---|---|
| 1 | 三栏布局 | 已满足 | `LAYOUT.md` 拓扑（Sidebar + Sessions Part + Editor/Aux/Panel） |
| 2 | 无浏览器式 Tab，侧栏线程树唯一切换入口 | **部分满足**（呈现层；follow-up FU-1，§8） | `chatGroupView.ts` chat-tab 呈现层仍在 |
| 3 | Composer 项目选择器 | 已满足 | `projectBarPart.ts`、`sessionWorkspace.ts` |
| 4 | 工作模式合一控件（local/worktree/cloud） | **部分满足**（follow-up FU-2，§8） | 能力在（`Isolation='worktree'`、remoteAgentHost），控件分散 |
| 5 | 分支选择器 | 已满足 | `agentHostSessionBranchActions.ts` |
| 6 | 模型+effort 合一选择器 | **部分满足**（follow-up FU-3，§8） | `agentHostAgentPicker.ts` + `CODEX_REASONING_EFFORTS` 分离控件 |
| 7 | 审批模式下拉 | 已满足 | `agentHostCodexApprovalsPicker.ts` + permissions preset 体系 |
| 8 | @ 文件搜索 | 已满足 | `agentHostInputCompletions.ts` |
| 9 | `$` 技能 / `/` 命令 | 部分满足 | 技能发现工作（218 项实测）+ `agentHostSkillButtons.ts`；slash 逐项对照留迭代 |
| 10 | 运行中 Enter=注入 / Tab=排队 | **已满足（D07 实测闭环，键位差异见注）** | **`chat.requestQueuing.defaultAction` 注册默认 `'steer'`（`chat.shared.contribution.ts:1913`，D07 新增断言 pin 住）；既有测试 `chatQueueActions.test.ts`「with default=steer, Enter steers and Alt+Enter queues」断言 Enter=steer/Alt+Enter=queue；`registerChatQueueActions` 经 `sessions.common.main.ts:225` → `chat.shared.contribution.js` 在 Agents 窗口注册。键位差异：Codex 用 Tab 排队，本仓库用 Alt+Enter——属 F-gates「显式非触发」的纯键位差异，见 §8 FU-4** |
| 11 | 侧栏 Projects→threads 树 | 已满足 | workspace 分组 + pinned/archived（`SESSIONS_LIST.md`） |
| 12 | 侧栏线程状态 Running/Waiting/Completed | 已满足 | `sessionStatusIcon.ts`；D07 首启冒烟截图可见侧栏体系 |
| 13 | ⌘N 新线程 | 已满足 | `chat.contribution.ts` Ctrl/Cmd+N（有测试） |
| 14 | ⌘K/⌘⇧P 命令菜单 | 部分满足 | ⌘⇧P 标准；⌘K chord 前缀文化差异 |
| 15 | ⌘B / ⌘J | 已满足 | `layoutActions.ts` |
| 16 | ⌘O 添加项目 | 部分满足 | workspace 添加路径在；语义对齐留迭代 |
| 17 | ⌘G 全局线程搜索 | **已满足（D07 实测闭环）** | **能力原已存在：`sessions.showSessionsPicker` 全局会话搜索 picker（"Search sessions by name or folder"，`sessionsActions.ts:1144`）。D07 补齐键位：新增 ⌘G/Ctrl+G 次键位绑定（`sessionsActions.ts` ShowSessionsPickerAction，editor-area 聚焦时让位 Find Next/Go to Line），并有 unit 断言（`sessionsPickerKeybinding.test.ts`）** |
| 18 | ⌘⇧[/] 线程切换 | 部分满足 | chat tabs 键位体系；差异属键位层 |
| 19 | 右栏五 tab（Files/Side chat/Review/Terminal/Browser） | **部分满足**（follow-up FU-5，§8） | 能力全在（Aux Bar + Panel + editor browser/diff + sideChat），非固定五 tab 形态 |
| 20 | Home = 大 composer + 最近线程 | 部分满足 | `sessionsEmptyState.ts`；D07 冒烟截图可见大 composer |
| 21 | （负向）首启不得有不可跳过登录墙 | **已满足（D04 已合并 + D07 复测）** | **见 §3 F3：D07 全新 profile 冒烟实测，可跳过进入可用 composer** |
| 22 | 按住说话 / Ctrl+M 语音 | 已满足 | `newChatVoice.ts` + `voiceBridge.contribution.ts` |
| 23 | Triage / Review 收件箱 | 部分满足 | changes 视图 + codeReview 在；聚合形态未呈现 |
| 24 | Settings 固定侧栏底部 | 部分满足 | 设置经标准菜单；锚位未做 |
| 25 | 左栏 Plugins / Automations | 已满足 | **D07 冒烟截图可见 Plugins / MCP Servers / Skills / Automations** |
| 26 | ⌘⇧O 线程内跳转 | 部分满足 | `sessionsActions.ts:1178` picker 在；语义贴合度留迭代 |
| 27 | 窗口 chrome | 部分满足 | 归 D06 品牌化一并 |
| 28 | 无常驻 StatusBar/ContextBar | 已满足 | `LAYOUT.md:22` 明示 omit |

**汇总（D07 后）**：已满足 16 / 部分满足 12 / 缺失 0。D17 基线（12/13/2 待实测/1 缺失）的 2 项待实测全部闭环转已满足，1 项缺失（#21）随 D04 转已满足。**无能力层缺口**；全部「部分满足」均为呈现/布局/键位层收敛，不触发 F2（见 §3）。

---

## 3. fallback 决策门 F1–F4 逐项结论（验收 2 对照 D17 §6）

| Gate | 触发条件 | D07 结论 | 证据 |
|---|---|---|---|
| **F1 审批保真** | 7 类审批中 ≥2 类无法在 Agents 窗口表达区分语义且单项修复 >1 人周 | **未触发** | 7 类审批（command / writeStdin / fileChange / permissions / requestUserInput / MCP elicitation / Guardian auto-approval review + deny override）在协议层全量接线（`codexAgent.ts:2643/2651/2671/2679/3808/4008`），经 `agentHostSessionHandler.ts` 映射为 chat 确认/工具调用 UI，区分语义完整；无一类缺失入口 |
| **F2 范式阻力** | 「部分满足」≥4 项无法收敛（含 #2 或 #19），或需改 workbench 核心布局 | **未触发** | 12 项部分满足全部有收敛路径且均在 sessions 呈现层（§8 FU-1~FU-5 已开 follow-up 含代价估算）；无一需要改动 workbench 核心布局（LAYOUT 层自包含于 `src/vs/sessions/`） |
| **F3 首启阻断** | D04 后全新 profile 首启仍无法在无登录下进入可用 composer | **未触发（D07 复测通过）** | D04 已合并（PR #23 + follow-up `76b0fdfe061`；`AgentHostAllowSignedOutWhenUsableProductDefault = true`，`agentService.ts:189`）。D07 实测：全新 profile 裸启动 → Agents 窗口 + 可跳过登录提示（"Continue Without Signing In"）→ 点击后进入可用 composer（Workspace picker + 输入框 + Models）。证据截图：`evidence/d07-first-launch-agents-default.png`、`evidence/d07-first-launch-continue-without-signin.png` |
| **F4 维护断层** | 上游 2 个月 agentHost 提交 <5 或连续两轮 rebase >5 人日 | **未触发** | 本地历史近 2 个月 `src/vs/platform/agentHost` 提交 1072 个，上游推进活跃 |

**裁定维持 agentHost 路线，不回退 grok-build。**

---

## 4. 默认启动形态实现（验收 3）

**裁定点**：`src/vs/code/electron-main/app.ts` `openFirstWindow()` —— 启动参数/入口的最终分发处。

**实现**（产品级默认，非启动脚本 hack）：

1. `product.json` 新增 `"defaultWindow": "agents"`；类型落在 `src/vs/base/common/product.ts`（`defaultWindow?: 'agents'`，缺省保持上游经典行为）。
2. 新增纯函数 `shouldOpenAgentsWindowOnStartup()`（`src/vs/code/node/agentsWindowStartup.ts`）：product flag 关闭时恒 false；以下显式打开意图全部让位常规窗口——CLI 路径、`--folder-uri`/`--file-uri`、`--new-window`/`--reuse-window`、`--profile`/`--profile-temp`、macOS open-file 事件、`--wait`/`--diff`/`--merge`/`--remote`。`--agents` 仍由原分支优先处理。
3. `openFirstWindow` 在「无文件/文件夹参数」分支末尾调用该谓词，命中即走 `windowsMainService.openAgentsWindow({...})`，与 `--agents` 完全同路径（`ensureAgentsWindow` 复用），遥测来源标 `AgentsWindowOpenSource.StartupDefault`（新增枚举值）。
4. **常规窗口能力零删减**：所有显式入口原样保留；`agents.returnToVSCodeEditor`（Agents→常规）与 `workbench.action.openAgentsWindow`（常规→Agents）双向可达。

**行为变化说明（有意为之）**：裸启动不再恢复上次常规窗口（`window.restoreWindows` 路径被 Agents 默认接管）；这与 `--agents` 既有语义一致（带 `urisToOpen` 的 initialStartup 不做 restore）。需要上次工作区的用户经深链/命令显式打开常规窗口。

**Hot-exit/崩溃恢复影响（显式裁定，审查补记）**：常规窗口的 untitled 未保存内容 hot-exit 备份只在打开常规窗口（同 workspace/空窗口）时恢复。默认入口改为 Agents 窗口后，恢复路径从「自动弹出」变为「用户主动打开常规窗口」。这不是数据丢失（备份仍在磁盘），是恢复发现性的回退；接受该取舍，后续可加「存在未恢复备份时 Agents 窗口提示」的引导（FU 级跟进项）。

**实测（验收 3 + 验收 8）**：全新 profile（`/tmp/d07-smoke*-ud`）裸启动，窗口标题 "Agents"、URL `out/vs/sessions/electron-browser/sessions-dev.html`，登录提示可跳过（F3 证据截图）。✅

---

## 5. `sessionsWindowAllowedExtensions` 白名单裁定（验收 7）

**裁定：保持空白名单 `[]`。**

| 决策点 | 结论 |
|---|---|
| 允许项 | 无（空集） |
| 理由 | ① Agents 窗口的会话能力全部由 in-tree contrib + agentHost 内核提供，不依赖第三方扩展；② 白名单是 `extensionEnablementService._isDisabledBySessionsWindow` 的**最高优先级逃逸口**（命中即无条件启用，绕过 builtin 能力审核与 `canExecuteOnSessionsWindow`），每加一项都是对会话窗安全/性能边界的实质扩大；③ chat 扩展（`_chatExtensionId`）与能力审核过的 builtin 已有独立放行通道，不占白名单 |
| 防意外扩大断言 | `src/vs/code/test/node/agentsWindowStartup.test.ts`「product defaults (D07)」套件 pin 住 `product.sessionsWindowAllowedExtensions` 深等于 `[]`（读取真实 product.json 生成的 product 模块）——任何人向白名单加项都会红 CI，需在 MR 中显式说明理由并同步更新本文档 |
| 新增条目流程 | 显式产品/安全评审 → 更新 product.json + 断言期望值 + 本节表格 |

---

## 6. 会话互通（验收 5）

| 互通路径 | 状态 | 断言 |
|---|---|---|
| `agent-host-session://` 深链 → Agents 窗口 | 已有（D06 验证参数化；`openSessionLink.ts` 解析 + `app.ts:1051` 冷启动深链分支 + `openSessionLinkOpener.contribution.ts` 两窗口各一） | `openSessionLink.test.ts` 18 例通过（D07 复跑） |
| 「在编辑器中打开」（Agents → 常规窗口，远端 authority 解析） | 已有 | **D07 新增** `src/vs/sessions/test/browser/openInVSCodeUtils.test.ts` 9 例：`sshAuthorityString`（明文/hex 编码分支）+ `resolveRemoteAgentHostEntryAuthority`（sshConfigHost 优先、tunnel label 回退、WSL、dev-container hex、websocket/cloudSandbox 无 authority） |
| 常规窗口 → Agents 窗口 | `workbench.action.openAgentsWindow`（`agentSessionsActions.ts:160`） | 既有 `agentSessionsActions.test.ts` |
| 同一会话两侧可见 | `agentSessions` 视图 + `sessionTypeAvailability` 对齐（`agentHostSessionListContribution.ts` 与 sessions provider 共用 `shouldSurfaceLocalAgentHostProvider` 同一判定函数） | D07 新增 AC6 穷举（§7） |

---

## 7. 配置一致性（验收 6）

`shouldSurfaceLocalAgentHostProvider` 在两种窗口读不同设置项（Agents 窗口读 `chat.agentHost.codexAgent.enabled`，常规窗口读 `chat.editor.codex.preferAgentHost`）。产品默认下两者一致由两层断言保证：

1. **穷举真值表**（`agentService.test.ts`「exhaustive isSessionsWindow x configuration truth table (D07 AC6)」）：`isSessionsWindow` × claude{unset,true,false} × codexEnabled{unset,true,false} × preferAgentHost{unset,true,false} 全组合，断言窗口隔离（各读各的设置）与跨窗一致性不变量（两 gate 同值时两窗结果一致）。
2. **注册默认值平价**（`codexProviderGatesConfiguration.test.ts`「Codex provider gates default identically in both window forms」）：两个设置从真实配置注册表读出，`default` 严格相等（当前均为字面量 `true`（R12，D06 已固化并有守卫））——防止未来有人单边改默认值造成两窗形态分裂。

---

## 8. 后续工作（「部分满足」呈现层项的 follow-up，不在本 Issue 实现）

| FU | 对应基准项 | 内容 | 代价估算 | 建议去向 |
|---|---|---|---|---|
| FU-1 | #2 | chat-tab 呈现层收敛为侧栏单入口（需产品决策：多会话并排 grid 是本仓库超集能力，裁不裁） | 低-中（布局策略 + 默认值；含产品决策） | 新子 Issue（area:ux） |
| FU-2 | #4 | composer 单一「工作模式」控件收敛 local/worktree/cloud | 中 | 新子 Issue（area:ux） |
| FU-3 | #6 | 模型+effort 合一选择器呈现合并 | 低 | 新子 Issue（area:ux） |
| FU-4 | #10 注 | Tab=排队键位（当前 Alt+Enter；改 Tab 需处理 composer 内焦点导航冲突） | 低 | 新子 Issue（area:ux，键位重映射决策） |
| FU-5 | #19 | 右栏固定五 tab 形态（Files/Side chat/Review/Terminal/Browser） | 中（布局策略层，能力无缺口） | 新子 Issue（area:ux） |
| — | #9/#14/#16/#18/#20/#23/#24/#26/#27 | 键位/锚位/聚合呈现类零散差异 | 各项低 | 随上述子 Issue 顺带或单独迭代；均不构成路线级 fallback（F-gates「显式非触发」） |

---

## 9. Web 变体裁定

`scripts/code-sessions-web.sh`（Web 版 sessions）：**排除**。依据 issue 非目标「不做 Web 版部署」；`sessionsAuthGate.ts` 亦明示 Web 恒要求登录（`isWeb` 分支），与本产品「无墙首启」形态冲突。脚本保留不删（上游资产），不作为交付目标。

---

## 10. 验证记录与 manual verification 声明

**自动化（D07 全绿）**：
- `agentsWindowStartup.test.ts`（8 例：谓词全分支 + product 默认 pin + 白名单 pin）
- `agentService.test.ts` AC6 穷举（41 例含新增）
- `codexProviderGatesConfiguration.test.ts`（默认平价 + steer 默认 pin）
- `sessionsPickerKeybinding.test.ts`（⌘G 绑定与 editor 让位）
- `openInVSCodeUtils.test.ts`（9 例互通断言）
- 回归复跑：`chatQueueActions` 7 / `chatConfiguration` 8 / `sessionsPicker` 3 / `openSessionLink` 18 / `sessionsReopenKeybinding` 3 / `sessionsFocusActiveSessionKeybinding` 3 / `sessionsActions` 28 —— 全绿
- `npm run typecheck-client` 无错误；`node build/next/index.ts transpile` 干净

**冒烟（真实 Electron，transpile-only dev 构建）**：全新 profile 裸启动进 Agents 窗口、登录可跳过、composer 可用（§3 F3 截图）。

**Manual verification（超出自动化范围，按硬约束声明）**：AC4 完整闭环（真实 turn：写文件 + 跑命令 + 审批 → changes/diff → 中断 → 恢复）需付费额度与人工操作，本 Issue 不执行。复现步骤：完整构建（`npm run compile`，本机 worktree 为 transpile-only，内置扩展未编译不影响窗口形态结论）→ 裸启动 → Continue Without Signing In → 新建会话选工作目录 → 发起 turn → 审批一次命令 → 查看 changes → Esc 中断 → 重启窗口恢复会话。
