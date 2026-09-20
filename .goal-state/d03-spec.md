# D03 实施规格（Issue #5）— OpenAI 原生认证一等化

Branch: codex-desktop/d03-openai-native-auth（从 main 切出）
Repo: Colin4k1024/vscode（本地 /Users/ailabuser1/Desktop/gitcode/vscode）

## 已确认的现状（不要重复探索）

- `src/vs/platform/agentHost/node/codex/codexAccountState.ts:codexAccountStateFromResponse`
  把 `account.type==='apiKey'` 映射为 `status:'unavailable'`（G4 bug）。chatgpt → signedIn。
- `_refreshCodexModels`（codexAgent.ts ~2156）只在 `signedOut|error` 时清空目录，所以 apiKey
  被判 unavailable 后目录仍拉取，但下游 UI（账号菜单、`hasSignedInCodexChatGPTAccount`）
  把用户当作"未登录/不可用"，且 sign-out 不可用 → 这就是 G4 的实际伤害。
- ChatGPT 浏览器 OAuth 已实现：codexAgent.ts `_signInToChatGPT`（~1420），transient 连接
  等 `account/login/completed`；persistent 连接发布 authUrl 后由全局 handler 完成刷新。
- UI 链路：meta key `vscode.codexAccount`（`platform/agentHost/common/meta/codexAccount.ts`，
  `readCodexAccountInfo` 校验）→ workbench `services/agentHost/browser/codexAccountService.ts`
  （`createCodexAccountMenuActions`）→ sessions `contrib/accountMenu/browser/account.contribution.ts`。
  注意 common/codexAccount.ts 与 common/meta/codexAccount.ts 的关系先查清（疑似 re-export）。
- 协议已支持（generated，勿改）：`account/login/start {type:'chatgptDeviceCode'}` →
  `{loginId, verificationUrl, userCode}`；`account/login/cancel {loginId}`；
  `account/logout`；`account/rateLimits/read`；`account/usage/read`。
- rate limit：`account/rateLimits/updated` 通知当前**丢弃 payload 整体重读**（codexAgent.ts ~2608），
  天然满足"稀疏更新不清除旧值"；`codexAccountRateLimitFromResponse` 对非 finite usedPercent
  返回 undefined。缺的是**测试断言**（AC6/AC7）。
- 测试：`src/vs/platform/agentHost/test/node/codex/codexAccountState.test.ts`、
  `codexAccount*.test.ts`、`codexModelRefresh.test.ts`；browser 侧
  `workbench/services/agentHost/test/browser/`（找 codexAccountService 相关测试）与
  `sessions/contrib/accountMenu/test/browser/account.contribution.test.ts`。
- 运行单测：`npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/codex*.test.js"`
  （需先 transpile：`npm run gulp transpile-client-esbuild`；依赖安装中，见 /tmp/npm-ci.log）。

## 设计裁定（Tech Lead 已定，照此实施）

1. **G4**：`account.type==='apiKey'` → `{ usageSource:'openai', status:'signedIn', authType:'apiKey' }`。
   `other` 保持 `unavailable`。理由：API Key 是有效 OpenAI 凭据，app-server 可正常服务；
   signedIn 语义="已完成认证闭环"，authType 区分凭据种类。
2. **meta 合同扩展**：`ICodexAccountInfo` 增加 `authType?: 'chatgpt'|'apiKey'|'other'`、
   `deviceVerificationUrl?: string`、`deviceUserCode?: string`；`readCodexAccountInfo` 校验之。
   `_toAccountInfo` 发布 authType；email/planType/profileImage/rateLimit 仍仅 chatgpt（保守，
   rateLimits/read 对 apiKey 的可用性未证实，留 D16 评估）。
3. **UI**：signedIn+apiKey → 账号菜单显示 "OpenAI API Key"（localize），含 Sign Out；
   `hasSignedInCodexChatGPTAccount` 保持 chatgpt-only 语义，逐 caller 核对不受影响
   （若某 caller 实际表达"任何已认证 OpenAI 凭据"，新增 helper 而非改语义）。
4. **Device code**：sign-in request 值支持两种形态——裸 nonce（默认 browser flow，向后兼容）
   与 `deviceCode:<nonce>`。node 侧识别后者走 `chatgptDeviceCode`，把
   `{authUrl: verificationUrl? 不行——} 单独字段 deviceVerificationUrl/deviceUserCode` 随
   `authUrlNonce` 一起发布；transient 连接等待 completed，同 browser flow。
5. **取消（B11）**：新 meta key `vscode.codexAccount.signInCancelRequest`（值=sign-in nonce）。
   node 收到后：若该 nonce 对应进行中的 loginId → `account/login/cancel {loginId}`；
   收到 `{success:false}`（或 cancel 成功）→ 刷新账号并发布，回到未登录；**必须清掉
   进行中的 loginId/early completion 队列**；UI 新增 Cancel action（仅登录中显示）。
   无浏览器时超时不死等：spinner 由 UI 的 pending 态 + Cancel 覆盖（B12），node 不加自有超时。
6. **凭据卫生（AC9/D5）**：所有新增日志不得包含 token/auth.json 内容；userCode 可日志（一次性码）。
7. **API Key 录入 UI 不做**：AC1 由 CODEX_HOME 路径满足；PR 描述中显式记录此决策。

## 验收映射（Issue #5 → 交付物）

- AC1/AC2：G4 修复 + 语义线程化；真实 turn 验收超出单测范围 → 在 PR 描述标记
  "manual verification pending"，并提供复现步骤（CODEX_HOME 放 key 冷启动）。
- AC3：device code unit 测试（mock client 断言发布 verificationUrl+userCode、完成后 signedIn）。
- AC4/B11：cancel 单测——断言 loginId 清空、状态回未登录。
- AC5/B12：UI pending 态可取消（browser 测试断言 Cancel action 存在且触发 cancel request）。
- AC6/AC7：codexAccountState/codexModelRefresh 测试补断言。
- AC8/B22：codexProfileImage.test.ts 已有？核对 >1MiB/svg/nonce mismatch 用例，缺则补。
- AC10：上述测试文件全绿 + 新增 apiKey 分支用例。

## 硬约束

- 不改 `protocol/generated/**`；不动 `vscode-proxy`（Copilot）通路；不做 Bedrock/PAT UI/attestation。
- 遵循仓库既有代码风格（copyright 头、localize、dispose 模式）。
- 只改 D03 范围内文件；发现无关 bug 不开小差，记录到 PR 描述。
- 完成后：commit（conventional，前缀 `codex-desktop: D03 ...`），不要 push、不要建 PR
  （push/PR 由编排者统一做）。
