# D03 — OpenAI 原生认证一等化（OPENAI-AUTH）

> Issue：Colin4k1024/vscode#5（Part of #1）。日期：2026-09-20。
>
> **来源与基线**：本文件是 PR #58（codex-desktop/d03-openai-auth，superseded 关闭）的文档交付物。G4 代码修复已由 PR #25（`5dc4a65`，2026-09-20T01:33Z）合入 main——main 的 apiKey 返回语句与本分支逐字节相同；本文件不含代码改动。
> 本文件记录验收 10 条的证据对照与移交/限制登记。

## 1. 证据对照表

| # | 验收 | 证据 | 状态 |
|---|---|---|---|
| 1 | **API Key 冷启动**（仅 API Key、无 GitHub → 目录非空 + 真实 turn） | G4 修复（下述）后 API Key 账号一等可用；UI 冷启动端到端留待实机（用真 key 做一次交互登录）——**移交**（见 §3） | 核心修复完成 / UI 冷启动移交 |
| 2 | **ChatGPT 冷启动**（OAuth → signedIn + 目录非空 + 真实 turn） | 本会话 profile 已有 ChatGPT 凭据（`account/read planType=plus` 实测，BOOTSTRAP §6d 同证）；真实 turn 见联合冒烟（下述）。**注意**：本 profile 已有订阅，故不是真·冷启动；凭据为空目录的真冷启动留待实机 | 半实证 / 真冷启动移交 |
| 3 | **Device code** 展示 verificationUrl + userCode → signedIn | 代码路径存在（`codexAgent.ts:1476-1547` login/completed 监听 + 回传）；无头环境不可演示（需打开浏览器/用户码交互） | 代码存在 / 实机移交 |
| 4 | 负向 B11（登录取消 → success:false → 无 pending loginId） | 取消路径存在（`login/cancel` + completed 监听）；registry 断言留测试层 | 代码存在 |
| 5 | 负向 B12（不开浏览器 → 可取消无死等） | 同上 | 代码存在 |
| 6 | rateLimits/updated 稀疏更新（null 不清观测） | **未测**——实现代码从未读取 spendControlReached、全仓无该通知的测试引用；通知路径为全量重读并整体替换（无窗口即清除观测）。本文档不再宣称覆盖该项；该验收点移交 §3（或在 D05 时补测）。已验证的邻接项：usedPercent 非法值拒绝归零（codexAccountState.test.ts）+ 重读失败保留上次快照（codexModelRefresh.test.ts:1017） | 未测（移交） |
| 7 | Rate limit 桶化（仅 7 天窗口、5 分钟观测、未过 resetsAt、10 点桶、耗尽 100） | `codexProviderSwitchTelemetry.test.ts:41,60（5 分钟观测/未过 resetsAt/10 点桶断言）既有覆盖；codexAccountState.test.ts 的 weekly window 优选用例亦在 | ✅ |
| 8 | Profile image 负向 B22（>1MiB/svg/nonce 不匹配 → undefined） | `codexProfileImage.test.ts` 既有 | ✅ |
| 9 | D5 凭据不外泄（扫描日志/目录无明文 token/auth.json 内容） | agenthost.log 实测无凭据明文（launch 日志全量可读）；本冒烟后再次 grep 未见 | ✅ |
| 10 | 单测套件绿 + 新增用例覆盖 apiKey | 6492 passing；`codexAccountState.test.ts` 新增 apiKey 双断言 + Bedrock 回归 | ✅ |

**联合冒烟（验收 1 的 ChatGPT 半段；与 D04/#6 的登录墙解除共同构成 R6 的解药）——实测完成**（2026-09-20，全新 launch-profile profile，ambient `~/.codex` ChatGPT 订阅凭据，零 GitHub token）：

1. 启动 Agents 窗口：无不可跳过登录墙；首启对话框出现**可用的 "Continue without signing in"**（CDP 点击通过；D04 默认值）
2. 工作区信任对话框放行
3. Composer 输入 prompt（"创建 d03-smoke.txt 内容 D03-JOINT-SMOKE-OK，回 DONE"）→ **Enter 提交 → "Thinking" 出现 → 文件创建审批请求（file-change approval）出现 → 点击 "Allow" 放行 → turn 完成，agent 回复 DONE**
4. 凭据消耗实测（真实订阅计费路径）：本轮 turn 经 ChatGPT 订阅后端真实推理（planType=plus；另有 CLI 直连独立实测：codex exec → OK，17,495 tokens）
5. 窗口杀死后无 `codex app-server` 孤儿（清理验证）

残余限制（如实登记）：中断+恢复的 live 半段未在本轮 UI 冒烟中执行；AC1 的『跑命令』半段未执行（仅验证了文件创建+审批）；（CLI 层 turn/interrupt+resume 契约由既有 capture 覆盖）；写文件落盘的本地文件证据因会话使用 profile 记忆工作区（`grok-build`）而非探测目录而未能从磁盘复核——后续联合冒烟脚本应把会话工作区固定到临时目录（launch skill 支持参数）。

## 2. G4 修复（代码改动）

`codexAccountState.ts`：`apiKey` 从 `unavailable` 改为 `signedIn`（authType 'apiKey'）。理由与安全边界：**ChatGPT 专属消费者**（image generation、ChatGPT 账号钉定、配额快照归属）配对 `authType==='chatgpt'` 守卫，逐一核实；有意不加守卫的例外（允许 apiKey 用户进入）：`hasSignedInCodexOpenAIAccount`（OpenAI 账号即算）、`_defaultModelProvider`（目录来源无关 auth）、`account.contribution.ts:451`（头像刷新）、`codexAccountService.ts:98`（菜单动作）。见提交信息与 issue 评论。

## 3. 移交登记（不算完成）

- **真·API Key 冷启动 UI**：用真 API Key 在无 ChatGPT 凭据的 profile 走完登录→目录→turn（需一次性 key 交互）
- **Device code / B12 实机**
- **中断+恢复的 live 半段**（与 D13 C3 段联合验收亦可）

## 4. D10 裁定联动（本 issue 的产品定位）

ChatGPT 订阅登录在产品中标注为**个人自用/实验**；对外分发的默认认证为 API Key（BYOK）——落地归 D05 #7（默认 provider 策略）。
