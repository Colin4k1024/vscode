# D04 实施规格（Issue #6）— 解除 GitHub 强制耦合

Branch: codex-desktop/d04-remove-github-coupling（已从 main 切出，且编排者已完成 2 处代码修改并提交 commit 5d06389641e）：
1. `codexAgent.ts getProtectedResources()`：repo resource 降为 `required: false`（含注释）
2. `chat.shared.contribution.ts`：`chat.agentHost.allowSignedOutWhenUsable` → `default: true`，
   移除 experiment 门与 experimental tag，更新描述；同步更新
   `agentHostCustomizationConfig.ts` 的 host 侧描述。
**不要改动这两处已定稿的实现**；如需调整先记录在交付说明中。

先读 issue 原文 `.goal-state/issues/6.md`。

## 剩余工作（你的范围）

1. **AC2**：`resolveSignedOutWindowGate` unit 穷举（现有 `src/vs/sessions/test/browser/sessionsAuthGate.test.ts`
   扩展）：false→ForceGitHubSignIn；true+空→Unresolved；true+有非GitHub→Proceed；true+全GitHub→ForceGitHubSignIn。
2. **AC3**：`isAllowSignedOutWhenUsableEnabled` web 恒 false（`!isWeb` 守卫）unit 断言。
3. **AC4**：无 GitHub token 时 `_builtInGitHubMcpServer(...)` 返回 `{}`（unit，codex 侧）。
4. **AC6**：GitHub 相关 server tools（addcomment/resolvecomments/viewunreviewedcomments/PR 创建）
   在无 token 时返回结构化"未连接 GitHub"结果、不抛未捕获异常——先审计现状（找到这些 tool 的实现），
   不足则修实现（仅限 tool 返回层，不动 Copilot provider）；unit 覆盖每个 tool。
5. **AC7**：`chat.agentHost.githubMcpServer.enabled=false` 时不注入内置 GitHub MCP server（unit）；
   同时核对无 token 时该设置的可发现性描述（设置项 description 提及无 token 行为），不够则补文案。
6. **AC9**：核对 `applyCodexAgentHostPreference` 的 `codexExtensionHostAvailableWhen` 逻辑——
   无 Copilot 扩展时 Codex 仍出现在 session type picker；现有测试在
   `src/vs/sessions/contrib/providers/agentHost/test/browser/sessionTypeAuthRequirement.test.ts`
   附近，补缺失用例。核对 SessionTypeAuthRequirement 三态与 sessionTypeAvailability 判定在
   Codex+OpenAI 凭据下的映射（D03 把 apiKey 变 signedIn 后应为 Available）。
7. **AC8 回归守卫**：确认 103 个 codex replay capture 全绿（`npm run test-agent-host-e2e`）——
   你的改动不得破坏任何既有 capture（特别是 github-remote-with-changes 那条）。
8. **B9**（与 D05 联合验收部分除外）：无 GitHub token 且未显式选模型 → 不得抛
   AHP_AUTH_REQUIRED；审计 `chat.agentHost.allowSignedOutWhenUsable` 打开后的模型解析路径，
   unit 断言落到 OpenAI provider 或给出可操作引导。

## 硬约束
- 不删 GitHub 集成代码；不改 `node/copilot/`；不动 `extensions/copilot`（那是 D08）。
- `codexAgent.ts` 除编排者已提交的 `getProtectedResources` 外**不得再改**
  （该文件正被另一个 worker 在 d03 分支上大改，避免冲突）。AC4/AC6/AC7 的 codex 侧实现改动
  若必须落在 codexAgent.ts → 改为在交付说明里给出 patch 建议，由编排者合并时应用。
- 单测：`npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"` 与
  sessions 相关 browser 测试（browser 测试若本地跑不了，说明原因并确保代码编译过）。
  依赖状态见 /tmp/npm-ci.log。
- commit 前缀 `codex-desktop: D04 ...`，原子提交，不 push 不建 PR。

## 最终回复须包含
改动文件清单、每条 AC 的落点、测试运行结果、需要编排者应用到 codexAgent.ts 的 patch 建议（如有）、偏离说明。
