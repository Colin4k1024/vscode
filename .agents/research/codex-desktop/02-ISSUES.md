# Issue 拆分（17 张 + 1 Epic）

目标仓库：**`Colin4k1024/vscode`**（当前 0 issue，无重复；见 `00-FINDINGS.md` §5）
拆分原则：每张 Issue 都能**独立交付**（有自己的 PR 边界）且**独立验收**（有自己的自动化断言）。
共享验收内核：`01-ACCEPTANCE-CORE.md`（A/B/C/D 段编号在各 Issue 中被引用）。

**已提交到 `Colin4k1024/vscode`（2026-09-19）— Issue 编号对照：**

| 编号 | D00 | D17 | D01 | D02 | D03 | D04 | D05 | D06 | D07 | D08 | D09 | D10 | D11 | D12 | D13 | D14 | D15 | D16 |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|--- |
|---|
| GitHub | [#1](https://github.com/Colin4k1024/vscode/issues/1) | [#2](https://github.com/Colin4k1024/vscode/issues/2) | [#3](https://github.com/Colin4k1024/vscode/issues/3) | [#4](https://github.com/Colin4k1024/vscode/issues/4) | [#5](https://github.com/Colin4k1024/vscode/issues/5) | [#6](https://github.com/Colin4k1024/vscode/issues/6) | [#7](https://github.com/Colin4k1024/vscode/issues/7) | [#8](https://github.com/Colin4k1024/vscode/issues/8) | [#9](https://github.com/Colin4k1024/vscode/issues/9) | [#10](https://github.com/Colin4k1024/vscode/issues/10) | [#11](https://github.com/Colin4k1024/vscode/issues/11) | [#12](https://github.com/Colin4k1024/vscode/issues/12) | [#13](https://github.com/Colin4k1024/vscode/issues/13) | [#14](https://github.com/Colin4k1024/vscode/issues/14) | [#15](https://github.com/Colin4k1024/vscode/issues/15) | [#16](https://github.com/Colin4k1024/vscode/issues/16) | [#17](https://github.com/Colin4k1024/vscode/issues/17) | [#18](https://github.com/Colin4k1024/vscode/issues/18) |


> **⚠️ 先读 `00-FINDINGS.md` §7**：你已有三条并行路线（本仓库 agentHost / `grok-build` 自建 Electron / `grok-code-product` 瘦发行+ACP）。
> **D17 是新增的 P0 前置裁定**，门禁 D06 / D07 / D09，避免产生第四套重复资产。
> D06 / D07 / D09 / D10 / D14 已按 §7.3 修订为「移植先验资产」而非重写。

需要先创建的 label：
`codex-desktop`(#5319E7)、`P0`(#B60205)、`P1`(#D93F0B)、`P2`(#FBCA04)、
`area:agentHost`(#1D76DB)、`area:packaging`(#0E8A16)、`area:auth`(#D93F0B)、`area:quality`(#5319E7)、`area:legal`(#000000)

---

## EPIC — D00 [Epic] 自有品牌 Codex Coding Desktop App

```
标题：D00 [Epic] 基于 VS Code 1.139 + Codex app-server 的自有品牌 Coding Desktop App
标签：codex-desktop
```

### 背景

调研结论（详见 `.agents/research/codex-desktop/00-FINDINGS.md`）：**Codex 集成已存在于本仓库**——
`src/vs/platform/agentHost/node/codex/`（26 文件 / ~15k LOC）、828 个 vendored 协议类型、103 个确定性
replay e2e capture、`AGENTS.md` 自述 Status: COMPLETE (2026-07-01)。同时 `src/vs/sessions/` 已是一个
agent-first 的独立窗口形态（`--agents`）。

因此本 Epic **不是**"从零集成 Codex"，而是四条工作线：

0. **先裁定**（D17）：三条并行路线的取舍与先验资产归并 —— **门禁 D06/D07/D09**
1. **可运行**（D01–D02）：仓库 bootstrap + Codex 二进制的出厂供给与版本锁
2. **可独立**（D03–D05）：OpenAI 原生认证一等化，解除 GitHub/Copilot 强制耦合
3. **可发布**（D06、D08–D10、D15）：品牌、遥测隔离、打包、合规、扩展生态
4. **可信任**（D11–D14、D16）：验收矩阵、不变量守卫、负向/并发/崩溃、上游同步、能力评估

### 依赖顺序（关键路径）

```
Wave 1  D01 ─────────────────────────────┐
        D10 (合规裁定，可并行启动，门禁发布)  │
                                          ▼
Wave 2  D02 (依赖 D01)          D11 D12 D13 (依赖 D01+D02)
        D17 (依赖 D01，门禁 D06/D07/D09)
                                          │
Wave 3  D03 D04 (依赖 D02)      D06 D08 (依赖 D01 + D17)
                                          │
Wave 4  D05 (依赖 D03+D04)      D07 (依赖 D04 + D17)   D14 (依赖 D02+D11)
                                          │
Wave 5  D09 (依赖 D02+D06+D08+D17，且被 D10 门禁)
                                          │
Wave 6  D15 (依赖 D09)          D16 (依赖 D03+D05)
```

### 放行门

- **MVP 门**：D01 D02 D03 D04 D05 D11 D12 D13 全绿 → 内部可用的"零 GitHub、仅 OpenAI 凭据"桌面 app
- **发布门**：追加 D06 D08 D09 D10 D15 → 可对外分发
- **非阻断**：D07 D14 D16

### Task list

- [ ] D17 路线裁定与先验资产归并（**P0 前置，门禁 D06/D07/D09**）
- [ ] D01 构建与启动基线
- [ ] D02 Codex 二进制供给与协议版本锁
- [ ] D03 OpenAI 原生认证一等化
- [ ] D04 解除 GitHub 强制耦合
- [ ] D05 默认 provider / 模型 / 权限策略
- [ ] D06 产品身份与品牌
- [ ] D07 Agents 窗口作为默认桌面形态
- [ ] D08 Copilot 依赖与第三方遥测出口隔离
- [ ] D09 本地打包流水线与自托管 SDK 分发
- [ ] D10 许可、商标与再分发合规裁定
- [ ] D11 确定性 replay 验收矩阵扩展
- [ ] D12 状态机不变量守卫（I1–I8 + Codex 生命周期）
- [ ] D13 崩溃 / 并发 / 恢复 / 背压 负向验收
- [ ] D14 上游同步与版本升级 runbook + CI 门禁
- [ ] D15 扩展市场与生态可用性
- [ ] D16 未接线 Codex 能力评估

---

## D17 [P0] 路线裁定与先验资产归并

标签：`codex-desktop` `P0` `area:packaging`

### 目标
在投入 D06/D07/D09 之前，显式裁定产品内核路线，并把已有的三条并行路线的资产归并为「复用 / 移植 / 归档」清单，避免产生第四套重复实现。

### 背景（`00-FINDINGS.md` §7）
你已有三条路线：
- **本仓库 agentHost**（原生 in-tree，`codex app-server` 全量协议，103 replay capture，190 次上游提交）
- **`grok-build`**（自建 Electron + React + Tailwind，ACP 协议，Codex App Desktop 1:1 复刻，ISS-057 已完成控件级交互基准调研，HEAD `4d7eec40` 活跃）
- **`grok-code-product`**（Code OSS 瘦发行构建系统，Shell，`VERSION` 0.1.0，`UPSTREAM_COMMIT` `138f619c8`，10 个成熟脚本，patch 上限 5）
- 附：`grok-code-extension`（ACP 内置扩展，最后推送 2026-08-12）

推荐裁定见 `00-FINDINGS.md` §7.2：**agentHost 为内核 + 移植 grok-code-product 流水线 + 以 grok-build ISS-057 为 UX 基准**。本 Issue 的任务是把该推荐**实测验证**后定稿。

### 范围
- 实测复核 §7.1 对比表（不接受纸面推断）：
  - 在本仓库跑通一次 Codex 完整闭环（依赖 D01）
  - 在 `grok-build` 里验证 ACP 连接 `codex` 的实际能力面（审批/elicitation/MCP/skills 覆盖到哪一层）
  - 逐项统计 agentHost 的 app-server 方法覆盖 vs ACP 的能力覆盖
- `grok-code-product/scripts/` 10 个脚本逐个评估可移植性：`fetch-upstream.sh`、`apply-patches.sh`、`build.sh`、`package.sh`、`bundle-agent.sh`、`generate-icons.sh`、`generate-sbom.sh`、`check-update.sh`、`sync-upstream.sh`、`verify-beta-gates.sh`
- `grok-build` ISS-057 的 Codex App Desktop 交互基准 vs VS Code Agents 窗口（`src/vs/sessions/`）现状的**逐项差距表**
- 资产归属与归档决定（`grok-build` / `grok-code-extension` / `grok-code-product`）
- 定义 **fallback 触发条件**：哪些 UX 差距不可接受时回退到 grok-build 路线

### 非目标
- 不写实现代码
- **不删除、不归档任何仓库**（归档/删除需你显式授权）
- 不改 `grok-build` / `grok-code-product` / `grok-code-extension` 的代码
- 不做用户调研

### 依赖
D01。**门禁** D06 / D07 / D09。

### 回滚
纯文档。裁定可被后续实测推翻，届时重开本 Issue 而非静默改结论。

### 验收标准
1. `ROUTE-DECISION.md` 存在，含三路线的**实测**对比（附命令与输出摘要，不是推断）与明确裁定
2. ACP vs app-server 能力覆盖矩阵：逐方法列出（审批 7 类 / elicitation / dynamic tools / MCP / skills / hooks / fork / side-chat / checkpoint / rollout 恢复），标明各自支持度
3. `grok-code-product/scripts/` 10 个脚本逐个标注「直接复用 / 改造后复用 / 不用」，改造项写明改造点与预估工作量
4. `grok-build` ISS-057 交互基准**逐项**标注「VS Code Agents 窗口已满足 / 部分满足 / 缺失」，缺失项给出补齐代价
5. fallback 触发条件明确（哪些缺失项达到什么数量/严重程度时回退 grok-build）
6. 归档决定列出，且**明确标注需你授权后才执行**
7. D06 / D07 / D09 的 Issue 描述按裁定更新（在本 Issue 的 PR 中一并改）
8. `grok-code-extension` 的去留有结论

---

## D01 [P0] 构建与启动基线

标签：`codex-desktop` `P0` `area:packaging`

### 目标
让本仓库在**当前机器与 CI 上可复现地** bootstrap、编译、并同时启动常规编辑器窗口与 Agents 窗口，为后续所有验证提供地基。

### 范围
- 固化 Node 版本要求：`.nvmrc` = 24.18.0；本机为 v22.22.2，`build/npm/preinstall.ts:13-35` 会硬失败 → 提供 `fnm`/`nvm`/`volta` 三选一的落地指引与 `preinstall` 失败时的可读提示
- `npm ci` → `npm run compile`（含 `compile-client` + `compile-copilot`）→ `npm run download-builtin-extensions` 全链路一次通过
- 记录并解决 Electron 二进制下载、`extensions/copilot` 私有依赖（`@github/copilot`、`@vscode/copilot-api`）、built-in extensions 拉取三处常见失败点
- 打通两条启动路径：`./scripts/code.sh`（常规窗口）与 `./scripts/code.sh --agents`（Agents 窗口）；复用 `.agents/skills/launch/scripts/launch.sh [--agents]`
- 建立最小 CI job（可先 workflow_dispatch）：bootstrap → transpile → `codex:check-protocol-sync` → agent-host 单测子集
- 产出一份 `BOOTSTRAP.md`（放 `.agents/research/codex-desktop/` 下），记录实测耗时、磁盘占用、失败模式

### 非目标
- 不改任何业务代码逻辑（仅允许新增文档、CI workflow、脚本）
- 不做打包（D09）、不做品牌化（D06）
- 不升级任何依赖版本
- 不解决 `extensions/copilot` 的剥离（D08）

### 依赖
无（Epic 起点）。

### 回滚
纯新增（文档 + CI workflow + 可选脚本）。回滚 = 删除新增文件。不影响任何运行时行为。

### 验收标准
1. 干净 checkout 下，按 `BOOTSTRAP.md` 单条命令序列执行，**无人工干预**完成 install + compile，退出码 0
2. `npm run compile` 产物完整：`out/` **且** `extensions/*/out/` 均存在（`.agents/skills/launch/SKILL.md` 明确指出只跑 `transpile-client` 会导致扩展加载失败）
3. `./scripts/code.sh` 打开常规窗口，无 renderer ESM 错误、无 "Cannot find module .../extensions/.../out/extension.js"
4. `./scripts/code.sh --agents` 打开 Agents 窗口（`openAgentsWindow` 路径，`src/vs/code/electron-main/app.ts:1495`）
5. 用 launch skill 的 `--agents` 变体拿到 JSON（含 `cdpPort`/`agentHostPort`），CDP 可 attach，`tab-list` 非 `about:blank`
6. Agent Host 进程日志（`agentHostPort` 或日志文件）中出现 Codex provider 注册记录，或出现明确的可诊断未注册原因
7. CI job 在一次 `workflow_dispatch` 上全绿；`check-clean-git-state.sh` 通过（构建不产生脏文件）
8. `BOOTSTRAP.md` 记录三处常见失败点各自的**实际错误文本**与解法

---

## D02 [P0] Codex 二进制供给与协议版本锁

标签：`codex-desktop` `P0` `area:agentHost` `area:packaging`

### 目标
让 Codex 二进制在 **dev / 出厂构建** 两种形态下都有确定、可校验、不依赖 Microsoft CDN 的来源；并把"协议 pin ↔ 生成类型 ↔ 真实二进制"锁成一个原子可验证的三元组。

### 范围
- 明确并文档化三级解析链（`codexAgent.ts:_resolveSdkRoot`）：downloader（env override / `product.agentSdks.codex`）→ dev fallback（`resolveCodexDevSdkRoot`，仓库 `node_modules`）→ 报错
- 裁定版本策略：pin `build/codex/codex-version.txt` = **0.153.0** vs 本机 `/opt/homebrew/bin/codex` = **0.155.1** vs `/poc/codex` main。三选一并写入 runbook：
  - (a) 保持 0.153.0（改动最小，828 个生成文件不动）
  - (b) 升级到某个已发布版本（必须 `codex:gen-protocol` 全量重生成 + 103 个 replay capture 全绿）
  - (c) 跟 `/poc/codex` main（**不推荐**：`0.0.0-dev`，无版本自证）
- 为出厂构建提供 **自托管** SDK 分发：复用 `build/agent-sdk/package.ts`（`npm ci --ignore-scripts --omit=peer` → tar）产出各 target tarball，上传到自有对象存储，`urlTemplate` 指向自有域名
- 校验 `build/agent-sdk/agents/codex/package.json` 与根 `package.json` devDependencies 与 `codex-version.txt` 三者版本一致（`build/agent-sdk/test/versionSync.test.ts` 已强制，需确认覆盖 codex）
- 确认各平台 SKU 与 rust triple 映射：`codexPackageSuffix()` / `codexBinaryTriple()`，覆盖 `darwin-arm64`/`darwin-x64`/`linux-x64`/`linux-arm64`/`win32-x64`/`win32-arm64`；Codex Linux 为静态 musl，单一 `linux-*` SKU（`hasSeparateMuslLinuxPackage: false`）
- 断言 `verifyStagedTree` 对 codex 的行为：codex 无 `main`、只有 `bin` → 跳过 import 探针；但 `listPlatformBinaries` 必须命中 `vendor/<triple>/bin/`，且每个二进制 present + non-empty + executable

### 非目标
- 不改 `codexAgent.ts` 的业务逻辑
- 不改 `/poc/codex` 的 Rust 代码
- 不做安装包（D09）
- 不实现自动更新 SDK 版本
- 首版不做 armhf / web target

### 依赖
D01。

### 回滚
- 版本 pin：`git revert` 单提交即可（pin + 生成文件 + package.json 三处必须**同一提交**，revert 原子）
- 自托管分发：`product.agentSdks` 是纯 `product.json` 字段；移除即回到"未配置"状态，dev fallback 不受影响

### 验收标准
1. `npm run codex:check-protocol-sync` 退出码 0（生成物与 pin 版本二进制可复现一致）
2. 故意把 `codex-version.txt` 改成不匹配值 → `codex:gen-protocol` **失败**并打印实际/期望版本（负向 B3）
3. dev 路径：不设任何 env override，`_resolveSdkRoot` 解析到仓库 `node_modules`；日志出现 `[Codex] resolving SDK from repo node_modules (dev fallback): <path>`
4. `<root>/node_modules/@openai/codex-<platform>-<arch>/vendor/<triple>/bin/codex` 存在且 `fs.accessSync(X_OK)` 通过
5. 出厂路径：设 `product.agentSdks.codex = {version, urlTemplate}` 指向自有存储 → 首次使用时 downloader 成功下载、sha256 校验通过、缓存生效；断网二次启动仍可用
6. `VSCODE_AGENT_HOST_CODEX_SDK_ROOT` env override 优先于以上两者
7. 负向 B1：把二进制改成不可执行 → 错误文本为 `Codex binary not executable: <path> (...)`，provider **不注册**，agent picker 无 Codex，无崩溃
8. 负向 B2：出厂构建下 `product.agentSdks.codex` 缺失 → downloader 抛 `no \`product.agentSdks.codex\` configured`；`AgentChatMigrationDeferred` 生效，**不推进** migration marker，**不阻塞**其他 provider 的聚合 listing，且**不清空**已有 session 列表快照
9. `node build/agent-sdk/package.ts --sdk=codex --target=darwin-arm64 --out=/tmp/out` 产出可解包 tarball，解包后 `verifyStagedTree` 的 step 2 全绿
10. 版本决策写入 runbook，并说明选择理由与升级代价

---

## D03 [P0] OpenAI 原生认证一等化

标签：`codex-desktop` `P0` `area:auth` `area:agentHost`

### 目标
让"只用 OpenAI 凭据（ChatGPT 订阅或 API Key）、完全没有 GitHub"的用户能够走通完整闭环。修掉 **G4**（API Key 被判 `unavailable`）与登录 UI 闭环缺口。

### 范围
- **修 G4**：`src/vs/platform/agentHost/node/codex/codexAccountState.ts:codexAccountStateFromResponse` 当前把 `account.type === 'apiKey'` 映射为 `status: 'unavailable'`。需裁定并实现 API Key 用户的可用状态语义，使 `_refreshCodexModels` 不在 `status === 'unavailable'` 时清空目录（注意：现有逻辑只在 `signedOut`/`error` 时清空，需核对 `unavailable` 的实际下游影响）
- ChatGPT 浏览器 OAuth 闭环：`account/login/start {type:'chatgpt'}` → 返回 `{loginId, authUrl}` → 用系统浏览器打开（app-server 自持本地回调）→ `account/login/completed` → `account/updated {authMode:'chatgpt', planType}`；UI 展示登录中/成功/失败三态
- Device code 兜底：`{type:'chatgptDeviceCode'}` → 展示 `verificationUrl` + `userCode`（无浏览器/远程环境必需）
- 取消：`account/login/cancel {loginId}` → 收到 `{success:false}` → UI 回到未登录，**不留** pending loginId（负向 B11）
- 登出：`account/logout` → `account/updated {authMode:null}`；清理 `_openAIAccountState`、rate limit 缓存、profile image
- 账号信息面：`account/read`（可选 `refreshToken`）、`account/rateLimits/read` + 稀疏 `account/rateLimits/updated` 合并语义（`spendControlReached` 为 `null` 时**不得**清除上次观测值）、`account/usage/read`
- Profile image：沿用 `codexProfileImage.ts` 的 1MiB 上限 / media type 白名单 / `vscode-codex-profile-image:/profile-<sha256>.<ext>` nonce 校验
- 明确 `CODEX_HOME` 与凭据落盘位置（`auth.json` 或 keyring），并与 D 段 D5（凭据不外泄）联动

### 非目标
- 不实现 Amazon Bedrock（`amazonBedrock` / `amazonBedrockAccessKeys`，app-server 侧仍是 experimental）
- 不实现 `personalAccessToken` 的 UI（可经 `CODEX_ACCESS_TOKEN` 环境变量）
- 不做多账号切换
- 不改 `vscode-proxy`（Copilot）通路本身——那是 D04/D05 的边界
- 不实现 attestation（`requestAttestation` 保持 `false`）

### 依赖
D02。

### 回滚
- G4 修复是单函数改动，`git revert` 即回到"API Key 不可用"的当前行为
- 登录 UI 新增面可通过设置项/feature flag 关闭；不影响 `vscode-proxy` 通路

### 验收标准
1. **API Key 冷启动**：仅在 `CODEX_HOME` 放 API Key（或 `account/login/start {type:'apiKey'}`），无 GitHub token → 模型目录非空、能完成一次真实 turn（写文件 + 跑命令）
2. **ChatGPT 冷启动**：`account/login/start {type:'chatgpt'}` → 浏览器完成 → `account/updated {authMode:'chatgpt', planType:'plus'|'pro'|...}` → 目录非空 → 完成一次真实 turn
3. **Device code**：断言能展示 `verificationUrl` + `userCode` 并在完成后进入 signedIn
4. 负向 B11：登录后取消 → `account/login/completed {success:false}` → UI 未登录态、无 pending loginId 残留（unit 断言 registry 为空）
5. 负向 B12：不打开浏览器 → 超时后可取消；无死等 spinner
6. `account/rateLimits/updated` 稀疏更新：喂入不含 `spendControlReached` 的通知 → 断言上次观测值**未被清除**；喂入 `usedPercent` 非法值 → `codexAccountRateLimitFromResponse` 返回 `undefined` 而非 0
7. Rate limit 桶化：断言只接受显式 7 天窗口（`windowDurationMins === 10080`）、5 分钟内观测、未过 `resetsAt`；向下取 10 点桶；仅耗尽时为 100（对齐 D17）
8. Profile image 负向 B22：>1MiB / `image/svg+xml` / nonce 与 URI 不匹配 → 均返回 `undefined`，不渲染
9. D5：跑完 1+2 后扫描 `<userDataDir>`、`<CODEX_HOME>`、Agent Host 日志，无明文 OpenAI token / 无 `auth.json` 内容泄漏到日志
10. `codexAccount.test.ts` / `codexAccountState.test.ts` / `codexProfileImage.test.ts` 全绿，且新增用例覆盖 apiKey 分支

---

## D04 [P0] 解除 GitHub 强制耦合

标签：`codex-desktop` `P0` `area:auth` `area:agentHost`

### 目标
让 Agents 窗口与常规窗口的 Codex 体验在**完全没有 GitHub 登录**时可用、可解释、不撞登录墙。修掉 **G6 / G7**。

### 范围
- **Agents 窗口登录墙**：`src/vs/sessions/browser/sessionsAuthGate.ts:resolveSignedOutWindowGate` 当前在 `allowSignedOutWhenUsable` 未开时**无条件** `ForceGitHubSignIn`。裁定把 `chat.agentHost.allowSignedOutWhenUsable` 从 experimentation opt-in 变成本产品的默认值（通过 `product.json` / configurationDefaults，而非改函数逻辑）
- 核对 Codex provider 的 `getProtectedResources()`（`codexAgent.ts:1517-1528`）：copilot resource `required: false` 是刻意的（阻止 window gate 在用户能自我解释之前就把整个窗口挡掉）；repo resource 当前非 optional → 裁定是否也降为 optional
- `_startModelRefreshWhenSdkIsLocal()` 依赖 `allowSignedOutWhenUsable === true` 才会在未激活时探活 SDK；确认打开后行为符合预期（**不得**把启动账号探测变成长连接）
- **G7 GitHub 专属能力的优雅降级**：`_builtInGitHubMcpServer` 在无 token 时返回 `{}`（已是当前行为，需断言）；server tools 中 GitHub 相关项（`addcomment`/`resolvecomments`/`viewunreviewedcomments`/PR 创建）在无 GitHub 时不得崩溃、不得静默失败，需给出"未连接 GitHub"的明确结果
- `chat.agentHost.githubMcpServer.enabled` 开关的可发现性（设置项 + 无 token 时的说明）
- 常规工作台的 `chat.editor.codex.preferAgentHost`：确认在无 Copilot 扩展时 Codex 仍能出现在 session type picker（`applyCodexAgentHostPreference` 的 `codexExtensionHostAvailableWhen` 逻辑）
- 明确 `SessionTypeAuthRequirement` 的三态（`None` / `GitHub` / `Unusable`）在 Codex 上的映射，以及 `sessionTypeAvailability.ts` 的 `Available` / `SignInRequired` / `UpgradeRequired` 判定

### 非目标
- 不删除 GitHub 集成代码（保留可选路径）
- 不实现自有的 PR / 代码评审后端
- 不改 Copilot provider（`node/copilot/`）
- 不做 `extensions/copilot` 的剥离（D08）

### 依赖
D02。与 D03 并行可行，但**联合验收**（见下）。

### 回滚
- 默认值改动是 `product.json` / configurationDefaults 层面，revert 即回到 opt-in
- 若改了 `getProtectedResources()` 的 `required` 语义，revert 单提交

### 验收标准
1. **联合冒烟（与 D03 一起，构成 R6 的解药）**：全新 profile、**零 GitHub 登录**、仅 OpenAI 凭据 → 启动 app → Agents 窗口**不出现** GitHub 登录墙 → Codex 出现在 session type picker → 完成一次真实 turn（写文件 + 跑命令 + 审批 + 中断 + 恢复）
2. `resolveSignedOutWindowGate` unit 穷举：`allowSignedOutWhenUsable=false` → `ForceGitHubSignIn`；`=true` 且 `authRequirements` 为空 → `Unresolved`；`=true` 且至少一个 `!== GitHub` → `Proceed`；`=true` 且全为 `GitHub` → `ForceGitHubSignIn`
3. Web 平台断言：`isAllowSignedOutWhenUsableEnabled` 恒 false（`!isWeb` 守卫）
4. 无 GitHub token 时 `_builtInGitHubMcpServer(...)` 返回 `{}`（unit）
5. 负向 B9：无 GitHub token 且未显式选模型 → **不得**抛 `AHP_AUTH_REQUIRED`；落到 OpenAI provider 或给出可操作引导（这条与 D05 联合验收）
6. GitHub 相关 server tool 在无 token 时返回结构化的"未连接"结果，不抛未捕获异常（unit + 至少 1 个 replay capture）
7. `chat.agentHost.githubMcpServer.enabled=false` 时不注入内置 GitHub MCP server
8. 现有 103 个 codex replay capture **全绿**（本 Issue 不得破坏任何既有场景，特别是 `codex-a-github-remote-with-changes-advertises-pull-request-creation`）
9. 常规工作台（非 Agents 窗口）在无 Copilot 扩展时，Codex 仍可作为 session type 出现

---

## D05 [P1] 默认 provider / 模型 / 权限策略

标签：`codex-desktop` `P1` `area:agentHost`

### 目标
把"默认走 Copilot 代理"改成"默认走 OpenAI 原生"，并显式固化沙箱/权限预设，使产品行为可预测、可审计。修掉 **G5**，覆盖 **R9**。

### 范围
- **模型选择默认值**：`codexAgent.ts:1710` 的 `model ?? CODEX_COPILOT_MODEL_PROVIDER` 与 `_ensureModelProviderAuthenticated` 的 `AHP_AUTH_REQUIRED` 抛出条件；裁定产品级默认 provider（建议：有 OpenAI 凭据时默认 `openai`，否则才回落 `vscode-proxy`）
- `_defaultModel()` 取 `models[0]`；确认目录排序（`chatgpt` picker provider、native provider 的 declared default 排在最前）与产品期望一致
- 权限预设：`codexSessionConfigKeys.ts` 的 `CODEX_DEFAULT_PERMISSIONS_PRESET` / `CODEX_PERMISSIONS_PRESETS` / `resolveCodexPermissions` / `migrateCodexPermissionValues`；裁定本产品的默认 preset 与可选项
- 沙箱 profile：`codexLaunchConfig.ts:codexPermissionProfileOverrides()` 注入的三个 profile（`vscode-workspace` / `-network` / `-read-only`）与 `:root = deny` / `:minimal = read` / `:tmpdir = write` / `:slash_tmp`（Linux=read / 其他=deny）；确认 **Windows 走空 `fileSystemOverride`** 的分支语义
- 用户配置与注入覆盖的**优先级**：VS Code 的 `-c` 覆盖 vs 用户 `~/.codex/config.toml`；`_buildSessionMcpServers` 的合并顺序（root config → workspace discovery → client plugins，后者胜同名）
- 审批策略与 reviewer：`CodexApprovalPolicy`、`approvalsReviewer`（`user` / `auto_review`）、`codexGuardianReview.ts`；裁定本产品是否暴露 auto-review
- `codexPermissionProfile(mode, networkAccess)` 的三态映射：`danger-full-access` → `:danger-full-access`；`read-only` → `vscode-workspace-read-only`；否则按 `networkAccess` 二选一
- `AgentHostCodexMultiRootEnabledConfigKey` / `narrowAdditionalDirectories` 的多根工作区语义
- `features.default_mode_request_user_input = true`（`CODEX_DEFAULT_MODE_REQUEST_USER_INPUT_CONFIG_KEY`）与 `features.image_generation` 的门控（仅 `openai` provider + ChatGPT 订阅时开启）

### 非目标
- 不改 app-server 侧的 execpolicy / 沙箱实现
- 不新增 permission profile
- 不实现企业策略下发（沿用现有 `Codex3PIntegration` 策略点）
- 不改 Claude / Copilot provider 的默认值

### 依赖
D03、D04。

### 回滚
配置默认值改动集中在 `codexSessionConfigKeys.ts` / `codexProviderConfiguration.ts` / `codexLaunchConfig.ts`；每项独立 revert。建议每项默认值改动都带一个 feature flag 或设置项，使回滚可在运行时完成。

### 验收标准
1. 负向 B9（**这条是本 Issue 的核心**）：无 GitHub token、未显式选模型 → 不抛 `AHP_AUTH_REQUIRED`；使用 OpenAI provider 完成 turn
2. 负向 B13：在 `CODEX_HOME/config.toml` 写入试图放宽 `vscode-workspace` 的配置（如 `:root = "write"`、开启 network）→ 断言实际 spawn args 中 VS Code 的 `-c` 覆盖生效、profile 未被提权、network 仍关闭
3. D7/D8：在 `read-only` 与 `vscode-workspace` profile 下，让 agent 尝试 (a) 写工作区外路径 (b) 写 `.env` (c) 写 `~/.codex/config.toml` (d) 发起出站连接 → 全部被沙箱拒绝
4. `danger-full-access` 只在用户显式选择且策略允许时生效；断言 `codexPermissionProfile` 三分支穷举
5. A5.3–A5.6 全部有 unit/replay 断言：恢复保留已存模型；模型缺失时等待排队的 discovery 后从**同一 native provider** 选首个可用；**绝不跨计费 provider**；已存 provider 无可用模型时保留选择使历史可读；`thread/resume` params 含 `model` + `modelProvider`
6. A5.8：显式切换 provider 只在下次 send 时 reload 同一 thread；断言 threadId 不变、turn-id 映射未被清空、resume 前已 unsubscribe
7. A5.9：`agentHost.codexProviderSwitch` 只在 `turn/start` 于同一 thread 接受后计数；picker 改动 / 元数据读 / setup-only resume / 失败 send / send 前回退 → 均不计数
8. MCP 合并顺序：client plugin 与 root config 同名时 client plugin 胜（unit）
9. `features.image_generation`：仅 `openai` provider + `signedIn` + `authType==='chatgpt'` 时为 true（unit 穷举 `_imageGenerationEnabledForModelProvider`）
10. `codexModelSelection.test.ts` / `codexProviderConfiguration.test.ts` / `codexSessionConfigKeys.test.ts` / `codexLaunchConfig.test.ts` / `codexGuardianReview.test.ts` 全绿 + 新增用例
11. Windows 分支：断言 `codexPermissionProfileOverrides('win32')` 产出空 `fileSystemOverride` 且 `:slash_tmp` 为 `deny`

---

## D06 [P1] 产品身份与品牌

标签：`codex-desktop` `P1` `area:packaging`

> **先验资产**：直接采用 `grok-code-product/product/` 的结构（`product.json` + `branding/` + `default-settings.json` + `extensions.json`）与 `scripts/generate-icons.sh`。不要重写。（依据：`00-FINDINGS.md` §7.3；前置裁定：D17）

### 目标
把 `product.json` 与资源从 Code-OSS 换成自有产品身份，使 app 能与官方 VS Code **共存安装**、拥有独立数据目录、独立 URL protocol、独立图标与 bundle id。修掉 **G8**。

### 范围
- `product.json` 身份字段全量替换：`nameShort`、`nameLong`、`applicationName`、`dataFolderName`、`sharedDataFolderName`、`win32MutexName`、`win32DirName`、`win32NameVersion`、`win32RegValueName`、`win32{x64,arm64}{,User}AppId`、`win32AppUserModelId`、`win32ShellNameShort`、`win32TunnelServiceMutex`、`win32TunnelMutex`、`darwinBundleIdentifier`、`darwinProfileUUID`、`darwinProfilePayloadUUID`、`linuxDesktopName`、`linuxIconName`、`urlProtocol`、`serverApplicationName`、`serverDataFolderName`、`tunnelApplicationName`、`licenseName`/`licenseUrl`/`licenseFileName`、`reportIssueUrl`
- **关键陷阱（R12）**：`chat.agentHost.codexAgent.enabled` 与 `chat.editor.codex.preferAgentHost` 的默认值都是 `product.quality !== 'stable'`。若为了品牌化设置 `quality: 'stable'`，Codex 会**默认关闭**。→ 必须显式设置这两个配置默认值，不依赖 quality 推导；或保持无 `quality`
- 图标资源：`resources/{darwin,linux,win32}` 下的 icns/png/ico、`resources/linux/code-oss.desktop` 类模板
- `urlProtocol` 变更的连带影响：`parseExternalOpenSessionLinkUri(uri, productService.urlProtocol)` → `agent-host-session://` 深链与 `<protocol>://agents/agent-host-session/<provider>/<id>` 外部链接（`src/vs/platform/agentHost/common/openSessionLink.ts`）
- `dataFolderName` 变更的连带影响：launch skill 依赖 `~/<dataFolderName>-dev` 作为 authed profile 源；`sharedDataFolderName` 影响 Windows 的 GitHub session 存储位置
- `serverLicense` / `serverGreeting` / `serverLicensePrompt`
- About 对话框、Welcome、Walkthrough 文案中的产品名（避免残留 "Visual Studio Code"）
- 保留一个 **override 层**而非直接改 `product.json`：参考 `build/azure-pipelines/distro/mixin-quality.ts` 的 mixin 模式（`.build/distro/mixin/<quality>/product.json`），**并对齐 `grok-code-product` 已有的 `product/` 目录布局与 `apply-patches.sh` 机制**，使上游 rebase 时冲突面最小（对齐 R2）
- 图标：优先复用 `grok-code-product/scripts/generate-icons.sh`（已处理 icns/png/ico 多尺寸生成），而非新写

### 非目标
- 不改 `applicationName` 之外的 CLI 行为语义
- 不做代码签名 / 公证（D09/D11）
- 不做自动更新 feed
- 不移除 Copilot 相关内容（D08）
- 不做本地化文案的全量翻译

### 依赖
D01。**D17（路线裁定）**。被 D09 依赖。

### 回滚
若采用 mixin override 层：删除 mixin 目录 + 环境变量即回到 Code-OSS 身份。若直接改 `product.json`：单提交 revert。**必须**在 PR 描述里记录 `dataFolderName` 变更会导致既有 profile 不可见（用户数据"丢失"的观感），并提供迁移说明。

### 验收标准
1. 打包产物（或 dev 启动）中：窗口标题、About、任务栏/Dock 名称、`--version` 输出均为新产品名
2. `dataFolderName` 生效后，dev profile 目录为 `~/<newName>-dev`，与 `~/.vscode-oss-dev` 互不干扰
3. 与官方 VS Code / Code-OSS **同时安装**：macOS 两个 .app 共存、Linux desktop entry 不冲突、Windows 注册表 `win32RegValueName` 与 AppUserModelId 不冲突
4. URL protocol 深链：`<newProtocol>://agents/agent-host-session/codex/<id>` 能被 `parseExternalOpenSessionLinkUri` 解析并打开 Agents 窗口对应会话（对齐 `openSessionLink.test.ts` 现有断言）
5. **R12 守卫（本 Issue 最重要的一条）**：断言在最终 `product.json` 下，`chat.agentHost.codexAgent.enabled` 与 `chat.editor.codex.preferAgentHost` 的**有效默认值为 true**；若设了 `quality: 'stable'`，必须有显式 configurationDefaults 覆盖
6. Codex provider 在品牌化后的构建中仍成功注册（Agent Host 日志断言）
7. 图标：macOS Finder / Dock、Windows 资源管理器 / 开始菜单、Linux 桌面均显示新图标；无 Code-OSS 残留
8. 全仓库扫描（打包产物内）无 "Visual Studio Code" / "Code - OSS" 的用户可见残留（第三方许可文本与上游版权声明**除外**，需白名单化）
9. 采用 mixin override 层时：`git diff --stat` 对上游 `product.json` 的改动行数为 0
10. `product/` 目录布局与 `grok-code-product/product/` 对齐（或书面说明为何不对齐），`generate-icons.sh` 已移植并跑通

---

## D07 [P2] Agents 窗口作为默认桌面形态

标签：`codex-desktop` `P2` `area:packaging`

> **UX 基准直接采用 `grok-build` ISS-057 已完成的 Codex App Desktop 交互调研**（三栏布局、composer 内聚全部会话控件、无浏览器 tab、Projects→threads 树、右侧五 tab、完整快捷键表），**不重新调研**。（依据：`00-FINDINGS.md` §7.3；前置裁定：D17）

### 目标
裁定并实现产品的**主形态**：是以 Agents 窗口（`src/vs/sessions/`）为默认入口的 agent-first app，还是常规编辑器窗口 + 侧边栏 chat。修掉形态歧义（R10）。

### 范围
- 形态裁定文档：对比两种入口的能力面
  - Agents 窗口：`--agents` → `openAgentsWindow()`；`singlePaneWorkbench.ts`；30 个 contrib（editor / terminal / files / fileTreeView / search / changes / codeReview / workspace / accountMenu / automations / aquarium / onboardingTours）；`sessionsWindowAllowedExtensions` 白名单机制（当前 `[]`）
  - 常规窗口：完整 workbench + `chat.editor.codex.preferAgentHost` 让 Codex 走 Agent Host 而非扩展
- **以 `grok-build` ISS-057 的 Codex App Desktop 交互基准为验收目标**，逐项对照 Agents 窗口现状，产出差距表：
  - 三栏布局（左：New chat / Search ⌘G / Plugins / Automations / Pinned / Projects→threads 树 / Chats / Triage-Review 收件箱 / Settings 固定底部）
  - Composer 内聚：项目选择器 / 工作模式（Work locally / Worktree / Cloud）/ 分支选择器 / 模型+effort 合一选择器 / @ 文件搜索 / 审批模式下拉 / Send / 按住说话 / `$` 技能 / `/` 命令 / 运行中 Enter=注入指令、Tab=排队
  - **无浏览器式 Tab**，侧栏线程树是唯一切换入口
  - 右侧面板五 tab：Files / Side chat / Review(diff) / Terminal / Browser
  - 侧栏线程状态：Running / Waiting for approval / Completed
  - 快捷键：⌘N/⌘⇧O/⌘K/⌘⇧P/⌘B/⌘J/⌘O/⌘G/⌘⇧[/]/Ctrl+M
- **fallback 决策门**：若差距表中「缺失」项超出 D17 定义的触发条件，则回退 grok-build 路线（不在本 Issue 内实现回退）
- 若选 Agents 为主：默认启动参数、`sessions.html` 入口、首启 onboarding（`sessionsSetUpService.ts` / `onboardingTours`）、`sessionsWindowAllowedExtensions` 白名单内容
- 若选常规为主：`chat.editor.codex.preferAgentHost` 默认 true 的落地（D06 已处理 quality 陷阱）、Codex 在 session type picker 的排序（`chatSessions` 贡献点的 `order`）
- 两种窗口间的会话互通：`agent-host-session://` 深链、`openInVSCodeUtils.ts`、"在编辑器中打开"
- `isSessionsWindow` 分叉的配置读取（`shouldSurfaceLocalAgentHostProvider` 在两种窗口读不同设置项：Agents 窗口读 `codexAgent.enabled`，常规窗口读 `preferAgentHost`）——必须保证两者在产品默认下一致
- Web 变体（`scripts/code-sessions-web.sh`）明确纳入或排除

### 非目标
- 不重写 sessions 窗口的 UI
- 不新增 contrib 模块
- 不做移动端 / 触摸形态（`mobileNavigationStack.ts` 已存在，仅评估）
- 不做 Web 版部署

### 依赖
D04（登录墙解除后 Agents 窗口才可作为首启入口）。**D17（UX 基准与 fallback 触发条件）**。

### 回滚
形态选择是启动参数 + 默认设置层面；revert 即回到"两种窗口都需手动选择"。

### 验收标准
1. 形态裁定文档存在，列出两种入口的**能力差异表**（哪些 contrib 只在其中一个可用）
2. **Codex App Desktop 交互差距表存在**（以 `grok-build` ISS-057 为基准）：逐项标注「已满足 / 部分满足 / 缺失 + 补齐代价」，并对照 D17 的 fallback 触发条件给出结论
3. 冷启动（全新 profile）→ 直接进入裁定后的主形态，**无需**手动传 `--agents`
4. 主形态下能完成完整闭环：新建会话 → 选工作目录 → 真实 turn（写文件 + 跑命令 + 审批）→ 查看 changes/diff → 中断 → 恢复
5. 从主形态能打开另一个形态（深链或命令），且**同一会话**在两侧可见、状态一致（对齐 `agentSessions` 与 `sessionTypeAvailability`）
6. `shouldSurfaceLocalAgentHostProvider` 在两种窗口下的返回值一致（unit 穷举 `isSessionsWindow` × 配置组合）
7. 若 Agents 为主：`sessionsWindowAllowedExtensions` 的白名单内容被显式裁定（哪些扩展允许、为什么），并有断言防止意外扩大
8. 无 GitHub 登录时主形态可用（继承 D04 验收 1）
9. 差距表中每个「缺失」项要么开子 Issue、要么被 D17 的 fallback 裁定接管；**不得静默忽略**

---

## D08 [P1] Copilot 依赖与第三方遥测出口隔离

标签：`codex-desktop` `P1` `area:packaging` `area:legal`

### 目标
让出厂产物**不包含**、也**不联系** Microsoft/GitHub 的聊天代理与遥测端点，使隐私声明成立、依赖面收窄。修掉 **G10** 的遥测与默认代理部分。

### 范围
- `product.json.defaultChatAgent`（当前 `extensionId: GitHub.copilot` + 30 个 aka.ms 链接）：裁定移除 / 指向自有值 / 保留但禁用
- `product.json.agentsTelemetryAppName`（当前 `"agents"`）与 App Insights / `@vscode/extension-telemetry` 出口
- `product.json.webviewContentExternalBaseUrlTemplate`（当前 `https://{{uuid}}.vscode-cdn.net/insider/...`）：改为自有 CDN 或本地打包
- `product.json.builtInExtensions`（当前从 `github.com/microsoft/vscode-js-debug*` 拉取，带 sha256）：裁定保留（js-debug 是 MIT）还是自托管镜像
- `extensions/copilot` 的处置：这是**仓库内**的完整 Copilot Chat 扩展，依赖 `@github/copilot`、`@vscode/copilot-api`、`@github/blackbird-external-ingest-utils`（可能需 GitHub Packages 凭据）、`applicationinsights`、`vscode-tas-client`。三选一：(a) 保留但默认禁用 (b) 从打包中排除 (c) 从仓库剥离
  - 注意 `npm run compile` = `compile-client` + `compile-copilot`；剥离需同时改 `package.json` scripts、`build/gulpfile.extensions.ts`、`.vscode-test.js`
- Copilot provider（`src/vs/platform/agentHost/node/copilot/`）与 Claude provider（`node/claude/`）的默认注册：`agentHostMain.ts` 无条件注册 `CopilotAgent`；裁定是否保留
- `codexProxyService`（Responses→CAPI 代理）：D05 后若默认走 `openai` provider，此代理仍需保留为**可选**通路；断言无 GitHub token 时不启动、不监听端口
- 遥测总开关：`telemetry.telemetryLevel` 默认值；`codexTelemetryOverrides` 已强制 `analytics.enabled=false` / `feedback.enabled=false`，需断言不被覆盖
- `product.json.trustedExtensionAuthAccess`、`onboardingKeymaps`、`onboardingThemes` 中的第三方引用

### 非目标
- 不实现自有遥测后端（首版就是"关掉"）
- 不重写 chat 参与者/语言模型 provider 体系
- 不删除 `extensions/copilot` 源码（除非裁定 (c)，且需单独授权——涉及大量文件删除）
- 不改 `codexProxyService` 的实现

### 依赖
D01。被 D09 依赖。与 D10（合规裁定）强相关：D10 的结论决定本 Issue 的裁定方向。

### 回滚
全部是 `product.json` / 构建配置 / 默认设置层面。每项独立 revert。若剥离 `extensions/copilot`，revert 需同时恢复 scripts + gulpfile + 测试配置。

### 验收标准
1. **D1 网络出口白名单（本 Issue 的核心验收）**：在隔离网络 / mitmproxy 下完成 (a) 冷启动 (b) 一次真实 Codex turn (c) 打开一个 webview → 抓取全部出站连接 → 只出现白名单域名（OpenAI、用户自配 MCP、自有 CDN）；**断言无** `*.vscode-cdn.net`、无 MS/GitHub 遥测端点、无 App Insights
2. **D2**：断言 spawn args 恒含 `analytics.enabled=false` 与 `feedback.enabled=false`，即使用户开启 Agent Host OTel（对齐 `codexTelemetryOverrides` 注释）
3. **D3/D4**：未配置 OTel 时 `otel.trace_exporter="none"` / `otel.exporter="none"` / `otel.metrics_exporter="none"`；`otel.log_user_prompt` == `captureContent ?? false`
4. **D5**：扫描 `<userDataDir>` / `agent-host.db` / 日志，无凭据明文；`agent-host.db` 只存脱敏配置摘要
5. 无 GitHub token 时 `codexProxyService` **不监听任何端口**（`lsof` 断言）
6. 打包产物中不含被裁定排除的扩展与端点（**D18**）
7. `npm run compile` 与 `npm ci` 在**无 GitHub Packages 凭据**的环境下成功（若裁定 (b)/(c)）
8. Codex 完整闭环在 Copilot 完全不可用时仍然通过（继承 D03+D04 验收 1）
9. 每项裁定写入决策记录，被 D10 引用

---

## D09 [P1] 本地打包流水线与自托管 SDK 分发

标签：`codex-desktop` `P1` `area:packaging`

> **先验资产（关键）**：`grok-code-product` 已经是一套成熟的 Code OSS 瘦发行构建系统（`VERSION` 0.1.0，`UPSTREAM_COMMIT` pin，patch 上限 5）。本 Issue **移植其 `scripts/` 而非重写**：
> `fetch-upstream.sh` / `apply-patches.sh` / `build.sh` / `package.sh` / `generate-icons.sh` / `generate-sbom.sh` / `check-update.sh` / `sync-upstream.sh` / `verify-beta-gates.sh` 直接复用；
> `bundle-agent.sh` 改造为 `bundle-codex-sdk.sh`（内部调 `build/agent-sdk/package.ts`）。
> 关键差异：grok-code-product 需要 patch + bundle 一个 ACP 扩展；本方案下 Codex 集成**已在上游 in-tree**，因此 patch 数应为 **0**。（依据：`00-FINDINGS.md` §7.3；前置裁定：D17）

### 目标
产出可安装的桌面产物：平台包 + Codex SDK tarball 自托管 + `product.agentSdks` 注入，全部在自有基础设施上完成，不依赖 Microsoft 的 Azure Pipelines 与 CDN。修掉 **G2**。

### 范围
- 复用现有 gulp 平台任务：`vscode-<platform>-<arch>[-min][-ci]`（`build/gulpfile.vscode.ts:575-595`，含 `compileNativeExtensionsBuildTask` → `rimraf` → `packageTask` → `prepareCopilotRipgrepShimTask`；win32 追加 `patchWin32DependenciesTask`）
- **移植 `grok-code-product/scripts/` 作为外层编排**（而非新写一套）：逐脚本评估见 D17 验收 3。目标是 `fetch-upstream → apply-patches(0 patch) → bundle-codex-sdk → build → package → generate-sbom → verify-beta-gates` 一条链
- **自托管 agent-sdk 分发**：`build/agent-sdk/produce.ts` 的 `uploadOne` 当前指向 `main.vscode-cdn.net`（`buildCdnUrl` / `buildCdnUrlTemplate` 在 `common.ts`）。改为可配置 endpoint（对象存储 / 自建 HTTP），保留 HEAD-then-decide 幂等与"不同 sha 则 fail loud，拒绝覆盖内容寻址历史"语义
- **`product.agentSdks` 注入**：`produce.ts` 通过 `##vso[task.setvariable variable=AGENT_SDK_RESULTS_FILE]` 传结果给 gulp；本地/GitHub Actions 需等价机制（写文件 + env），由 `readAgentSdkResults()` 在 `packageTask` 的 `jsonEditor` 回调里合并进 `product.json`
- 首版 target 矩阵：**darwin-arm64**（本机优先）→ darwin-x64 → linux-x64 → linux-arm64 → win32-x64。不做 armhf / web / REH-web（`agentSdks` 对 REH-web 无消费者）
- macOS Universal 注意事项：同一 `product.json` 被 arm64 与 x64 共享，`{sdkTarget}` 由运行时 `resolveSdkTarget()` 替换 → 所有平台 job 必须发出**相同**的 `urlTemplate`
- Linux libc 检测：`detectLibcSync()`；Codex `hasSeparateMuslLinuxPackage: false`（静态 musl，单一 `linux-*` SKU）
- CI：GitHub Actions 上跑 `npm ci` → `compile` → agent-sdk produce → gulp 平台包 → 上传 artifact
- 产物完整性：sha256 清单、`checksums` 注入（`packageTask` 的 jsonEditor 已处理 `commit`/`date`/`checksums`/`version`）
- 首版**明确不做**：代码签名、Apple 公证、Windows Authenticode、自动更新 feed、增量差分（记录为已知限制，D20 标记为 N/A）

### 非目标
- 不做 `.deb`/`.rpm`/`.snap`（`build/gulpfile.vscode.linux.ts` 的 prepare/build 任务存在但首版不用）
- 不做 Windows 安装器（`build/gulpfile.vscode.win32.ts` 的 `vscode-win32-<arch>-<target>-setup`）——首版只出 portable 目录
- 不做签名/公证/自动更新
- 不改 `build/agent-sdk/package.ts` 的 `--omit=peer` 策略与 `verifyStagedTree` 语义
- 不做 REH / server 包

### 依赖
D02（SDK tarball 与版本锁）、D06（品牌）、D08（剔除项）、**D17（脚本移植清单）**。被 **D10 门禁**（合规裁定通过前不得对外分发）。

### 回滚
纯构建产物与 CI 层面；不影响源码运行时。回滚 = 停用 workflow、删除 artifact。`product.agentSdks` 移除即回到"未配置"（dev fallback 仍可用）。

### 验收标准
1. `darwin-arm64` 平台包在本机由**单条命令**产出，解包后可双击启动，显示 D06 的品牌
2. 打包产物的 `product.json` 含 `agentSdks.codex = {version, urlTemplate}`，`urlTemplate` 指向**自有域名**且含 `{sdkTarget}` 占位符
3. **出厂构建下 Codex provider 成功注册**（这是 G2 的直接验收）：Agent Host 日志断言；agent picker 出现 Codex；首次使用时 downloader 从自有 endpoint 下载、sha256 校验通过、缓存命中后二次启动不重复下载
4. 所有平台 job 发出的 `urlTemplate` **完全相同**（断言，macOS Universal 前提）
5. `resolveSdkTarget` 穷举：`{linux,darwin,win32} × {x64,arm64}` → 正确 SKU；`armhf` / web → `undefined`；Codex 在 musl Linux 上仍返回 `linux-<arch>`（无 `-musl` 后缀）
6. `uploadOne` 幂等性：同内容重传跳过；**不同内容**同路径 → fail loud 且不覆盖
7. `verifyStagedTree` 对 codex tarball：跳过 import 探针（无 `main`），但 `listPlatformBinaries` 命中 `vendor/<triple>/bin/` 且每个二进制 present + non-empty + executable；`chmodPlatformBinaries` 与断言使用同一函数（不可能不一致）
8. 打包产物内**不含** D08 裁定排除的项（**D18**）
9. CI 在 GitHub Actions 上全绿并产出可下载 artifact
10. 产物 sha256 清单存在且可校验
11. 已知限制被显式记录：无签名 → macOS 首次启动需右键打开 / `xattr -d com.apple.quarantine`；Windows 会触发 SmartScreen
12. **patch 数为 0**：`git diff --stat` 对上游被打包源码的改动为 0（所有定制走 mixin / product 目录 / 构建参数）；若不为 0，每项 patch 必须给出"为何不能用覆盖层"的理由（对齐 `grok-code-product` 的 5-patch 上限约束）
13. `generate-sbom.sh` 产出 SBOM，与 D10 的 `LICENSE-CLEARANCE.md` 依赖清单交叉一致（**D19**）
14. `verify-beta-gates.sh`（或移植后的等价物）在发布前跑通，门禁项包含 D10 的发布前 checklist

---

## D10 [P1] 许可、商标与再分发合规裁定

标签：`codex-desktop` `P1` `area:legal`

> **先验资产**：以 `grok-build/THIRD-PARTY-NOTICES`、`grok-build/AUDIT.md`、`grok-build/LICENSE`、`grok-code-product/docs/enterprise.md`、`grok-code-product/scripts/generate-sbom.sh` 为起点，不从白纸开始。（依据：`00-FINDINGS.md` §7.3）

### 目标
在**任何对外分发之前**，产出书面的合规裁定，覆盖 VS Code 源码、产品品牌、Codex、Copilot 扩展、内置扩展与第三方依赖。修掉 **G13**，解 **R1 / R4**。

### 范围（纯调研 + 文档，**不改代码**）
- **VS Code 源码**：MIT（`LICENSE.txt`）。区分"源码 MIT"与"产品名/图标/Marketplace 非 MIT"——参考 VSCodium 的公开做法与其踩过的坑
- **`@openai/codex`**：Apache-2.0（`/poc/codex/LICENSE` + `NOTICE`）。核对：NOTICE 的保留义务、商标条款、Rust 静态链接进来的全部 crate 许可（`cargo deny` / `codex-rs/deny.toml` 已有配置，可直接跑）
- **OpenAI 服务条款**：`codex-rs/app-server/README.md` 明确写着 —— `clientInfo.name` 被用于 **OpenAI Compliance Logs Platform**，"如果你在开发一个用于企业的新 Codex 集成，请联系我们把它加入 known clients 列表"。当前 VS Code 用的是 `CLIENT_INFO`（需查明其 `name` 值）。→ 必须裁定自有 app 该报什么 `clientInfo`，以及是否需要联系 OpenAI
- **ChatGPT 订阅额度用于自研客户端**：核对 OpenAI 使用政策是否允许非官方客户端使用 ChatGPT 订阅额度（vs API Key 计费）。这直接决定 D03/D05 的默认认证方式能否对外提供
- **`extensions/copilot`**：`@github/copilot`、`@vscode/copilot-api`、`@github/blackbird-external-ingest-utils` 的许可与再分发权；GitHub Copilot 商标
- **GitHub MCP server**：`resolveGitHubMcpServerConfiguration` 注入的内置 server 的使用条款
- **`builtInExtensions`**：`ms-vscode.js-debug` / `js-debug-companion`（MIT，但带 sha256 与 publisher 元数据）
- **Electron / Node / Chromium**：既有 `cglicenses.json` / `cgmanifest.json` 的覆盖度
- **字体与图标**：codicon 字体、产品图标
- **Marketplace**：`product.json` 无 `extensionsGallery` → 不得指向 MS Marketplace（其 ToS 限官方产品）；Open VSX 的许可与提交义务
- **输出**：一份 `LICENSE-CLEARANCE.md`，逐项给出「许可 / 义务 / 是否阻断发布 / 需要的动作」，以及一份**发布前 checklist**
- **复用先验资产**：`grok-build/THIRD-PARTY-NOTICES` 与 `AUDIT.md`（自建 app 的许可清单与审计结论）、`grok-code-product/docs/enterprise.md`（企业分发考量）、`generate-sbom.sh`（SBOM 生成）。明确标注哪些结论可直接沿用、哪些因路线不同而失效

### 非目标
- 不提供法律意见（须由法务/律师复核；本 Issue 只产出工程侧事实与选项）
- 不改代码（发现的义务由 D06/D08/D09 落地）
- 不申请任何商标
- 不联系 OpenAI/GitHub（如需联系，产出联系要点与话术草稿，实际联系需单独授权）

### 依赖
无（可与其他 Issue 并行启动）。但**门禁** D06/D08/D09 的对外发布。

### 回滚
纯文档。

### 验收标准
1. `LICENSE-CLEARANCE.md` 覆盖上述**全部 11 项**，每项含：许可证名称与出处文件路径、义务清单、是否阻断、落地动作归属的 Issue 编号
2. `cargo deny check`（或等价的 `codex-rs/deny.toml` 检查）在 codex 侧跑通，输出附在文档中；无未声明的 copyleft 依赖
3. 打包产物的第三方许可清单（**D19**）已生成，且与 `LICENSE-CLEARANCE.md` 的依赖列表**交叉核对一致**
4. `clientInfo.name` 的当前值被查明并记录；自有 app 应报的值被裁定；是否需联系 OpenAI 有明确结论
5. "ChatGPT 订阅 vs API Key 用于非官方客户端"有明确结论，并**反向输入** D03/D05 的默认认证裁定（若结论是"订阅额度不可用于非官方客户端"，D05 的默认必须改为 API Key，且 D03 的 ChatGPT 登录需降级为"仅个人自用"）
6. 发布前 checklist 存在，且 D06/D08/D09 的 PR 描述中**引用**该 checklist
7. 明确记录"本文档不构成法律意见"与需要法务复核的条目
8. **阻断项若存在**：Epic 的发布门被标记为未通过，D09 的产物标记为"仅内部使用"
9. 已显式比对 `grok-build/THIRD-PARTY-NOTICES` 与 `AUDIT.md`：逐项标注「可沿用 / 因路线不同而失效 / 需补充」
10. SBOM 生成方式确定（移植 `generate-sbom.sh` 或用仓库既有 `cglicenses.json`/`cgmanifest.json`），且与 D09 验收 13 一致

---

## D11 [P0] 确定性 replay 验收矩阵扩展

标签：`codex-desktop` `P0` `area:quality`

### 目标
把现有 103 个 Codex replay capture 扩展成**覆盖本产品全部承诺能力**的验收矩阵，并保证它在 CI 上无 token、无网络、严格确定性地跑。

### 范围
- 摸清现有资产：`src/vs/platform/agentHost/test/node/e2e/`（`README.md` 是权威说明）、`providers/codexAgentHostE2E.integrationTest.ts`、`providers/codexTestConfiguration.ts`、`captures/codex-*.yaml`（103 个）、`providers/__snapshots__/`
- 复用三条运行模式：replay（默认，CI 用）/ `AGENT_HOST_UPDATE_AHP_SNAPSHOTS=1`（只更新 AHP 快照，无 token 无网络）/ `AGENT_HOST_UPDATE_SNAPSHOTS=1`（重录 LLM fixture，需 `GITHUB_TOKEN`）/ `AGENT_HOST_REPLAY_RECORD=1`（只重录 LLM）
- 守住两条治理原则（README §Two governing principles）：
  1. **测试套件外在于实现**：只能通过 `IAgentHostTarget` 拿到运行实例，只能通过 WebSocket 上的 AHP 协议对话。禁止注册 test-only `IAgent`、禁止读 host 数据库、禁止断言日志输出
  2. **覆盖驱动选题**：用 `scripts/agent-host-e2e-coverage.ts` / `npm run test-agent-host-e2e-coverage` 找缺口
- 补齐 **D03–D05 新行为**的 capture：API Key 认证目录、ChatGPT 登录后目录、无 GitHub 的完整 turn、默认 provider 落到 openai、权限 profile 拒绝越权写
- 补齐**负向 capture**（对齐 `01-ACCEPTANCE-CORE.md` B 段）：B1/B2/B7/B8/B16/B17/B18/B25/B28
- 隔离性断言（README §Mental model 的 "Isolated persistent state"）：每个 provider suite 用临时 home + 临时 VS Code userDataDir；`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 等 ambient override 被清空；teardown 在 agent host 退出后删目录
- 严格性断言：未录制请求 = 硬失败（CI 永不静默访问真实后端）；每条录制响应必须在 teardown 前被消费完（提前停止的 provider 不能靠留下未用 fixture 通过）
- 明确"stubbed vs recorded"边界（README §What's stubbed-vs-recorded）：身份、token、模型目录被 stub，不进 fixture
- live 套件（`codexAgentHostLive.integrationTest.ts`，`AGENT_HOST_REAL_CODEX=1`）：明确哪些场景**只能** live（mid-turn steering、late tool registration、truncate），并把它们从 replay 矩阵中显式排除而非静默漏掉

### 非目标
- 不重构 e2e harness
- 不新增 provider
- 不改被测实现（发现 bug 另开 Issue）
- 不录制真实付费流量的大规模 fixture（成本考虑）
- 不动 `../protocol/` 旧套件（README 明确它 predates 原则 1 且违反之）

### 依赖
D01、D02。D03–D05 的行为定稿后可补对应 capture（可分批）。

### 回滚
纯测试资产。回滚 = 删除新增 capture 与用例。

### 验收标准
1. `npm run test-agent-host-e2e` 在**无 token、无网络**环境下全绿（现有 103 个 + 新增全部）
2. **D14 严格性**：故意注入一个未录制的请求 → 测试**失败**（而非静默通过或访问网络）
3. **D14 完整性**：故意让 provider 提前停止 → 测试**失败**并指出未消费的 fixture
4. **D13 隔离性**：在 shell 里 export `CODEX_HOME=/some/real/path` 后跑测试 → 断言测试**没有**读写该路径（用临时目录探针验证）
5. 新增 capture 覆盖 B 段的 B1/B2/B7/B8/B16/B17/B18/B25/B28，每条至少 1 个
6. 新增 capture 覆盖 D03（API Key 目录非空）、D04（零 GitHub 完整 turn）、D05（默认 provider = openai）
7. `npm run test-agent-host-e2e-coverage` 输出的覆盖率报告显示本产品承诺的能力面**无未覆盖分支**，或未覆盖项被显式登记为 live-only / 已知缺口
8. live-only 场景清单存在，且每项说明"为什么不能确定性重放"
9. CI 上 replay 套件作为**必过**门禁（不是 workflow_dispatch）
10. 治理原则 1 被守住：`grep` 断言测试文件不 import host 内部模块（除 `IAgentHostTarget` 与协议类型）

---

## D12 [P0] 状态机不变量守卫

标签：`codex-desktop` `P0` `area:quality` `area:agentHost`

### 目标
把 `01-ACCEPTANCE-CORE.md` **A 段**（A1–A5）从文档变成**可执行断言**，使协议层与编排层的不变量在每次 PR 上被机器验证。

### 范围
- **A1 turn 生命周期**：`idle → starting → started → active → {completed|failed|interrupted}` 的转移表穷举测试（对 `codexMapAppServerEvents.ts` 的 `createCodexSessionMapState` / `finalizeCodexTurnMapState` / `mapTurnStarted` / `mapTurnCompleted`）；A1.1–A1.5
- **A2 item 生命周期**：`item/started` ↔ `item/completed` 配对扫描器（跑遍全部 capture，断言 itemId 集合相等或差集落在 turn 终态清理窗口）；A2.1–A2.4
- **A3 审批闭环**（最高风险）：基于 `common/pendingRequestRegistry.ts` 的 pending 集合断言——turn 终态后 `pending.size === 0`；A3.1–A3.8。**fail-open 禁止**（A3.2）是硬性负向用例
- **A4 编排不变量 I1–I8**：
  - I1：AST 扫描 `AgentService` / `AgentHostStateManager` 不得对 `providerData` 做 `JSON.parse` 或属性访问；replay 断言 create → restart → materialize 后 `providerData` 字节级相等
  - I2：`isAhpChatChannel` / `parseDefaultChatUri` / `buildDefaultChatUri` 往返 + property-based 随机 URI
  - I3：默认 chat 的 backing 恢复不得假设 `sessionId === threadId`
  - I4：AST 扫描 `_chatEntries` 的写入点只允许 `addChat` / `registerRestoredChatSummary` / `removeChat`；spawn-channel 监听器注册顺序（DR1）
  - I5：authoritative-empty catalog 不得复活已删除 peer；`_persistDefaultChatBacking` 两个写的独立性（B28）
  - I6：provider 不得直接读 association map
  - I7：`backingSession` 不出现在 `listSessions`；`_markChatBacking` 失败一次 → 本进程内抑制而非创建失败
  - I8：`node/codex/**` 不得 import `AgentHostStateManager` —— **注意**：`AGENTS.md` §8 自述 Codex 切片"still inject the state manager"，这是**已知技术债**。→ 本 Issue 需把它登记为 **baseline（允许列表）**，只对**新增**违规失败，而不是直接红
- **A5 Codex 身份不变量**：A5.1–A5.9（`_sessionIdByChatUri` / `_sessionIdByThreadId` 语义、模型恢复的 provider 锁定、`thread/resume` 必带 model+provider、只读不抢 writer lock、provider 切换的 reload 语义、遥测计数时机）

### 非目标
- 不修复 I8 的既有技术债（登记为 baseline，另开 Issue）
- 不改协议类型（`protocol/generated/` 是生成物）
- 不新增运行时校验开销（守卫只在测试/CI 期）
- 不做性能测试

### 依赖
D01、D02。与 D11 互补（D11 是场景覆盖，D12 是不变量）。

### 回滚
纯测试与静态检查资产。若 AST 扫描误报率高，可降级为 warning + baseline 文件。

### 验收标准
1. A1.1–A1.5 各有至少 1 个可执行断言并通过；转移表穷举测试覆盖全部合法与非法转移
2. A2.1 的配对扫描器跑遍**全部 capture**（含非 codex 的）并输出报告；任何未配对 item 导致失败
3. A2.2：`mapItemCompleted` 后喂同 id 的 `mapItemStarted` → 状态不回退（unit）
4. **A3.1（核心）**：跑遍全部 codex capture，turn 终态后 `pendingRequestRegistry` 为空
5. **A3.2（核心负向）**：mock client 收到审批请求但**不响应** → 断言 (a) 无 `item/completed` (b) 无文件系统副作用 (c) 无命令执行 (d) turn 未进入终态。**禁止 fail-open**
6. A3.3：畸形 `decision` 输入穷举 → 全部归一为 `decline`
7. A3.4：两个并发 session，A 用 `acceptForSession` → B 仍收到审批请求（live）
8. A3.6：`resolveCodexPermissions` / `narrowAdditionalDirectories` 穷举——未出现的权限视为拒绝、请求中不存在的权限被忽略、`scope:'session'` 才跨 turn
9. A3.7：`isBlocking:true` → 无限等待；断言代码路径不读 `autoResolutionMs`
10. I1–I7 各有可执行守卫；I8 有 baseline 文件 + "新增违规即失败"的 CI 门禁
11. A5.3–A5.6、A5.8、A5.9 各有 unit 或 replay 断言
12. 全部守卫在 CI 上作为必过门禁
13. `01-ACCEPTANCE-CORE.md` A 段的每一行都能在代码里找到对应测试（建立**双向追溯表**，放在 Issue 评论或 `AGENTS.md` 附录）

---

## D13 [P0] 崩溃 / 并发 / 恢复 / 背压 负向验收

标签：`codex-desktop` `P0` `area:quality` `area:agentHost`

### 目标
验证 **B 段负向场景**与 **C 段并发/崩溃/恢复**，特别是"进程在跑但状态已 cancelled"这类不可接受的分裂态，以及 `-32001` 背压与连接替换。解 **R7 / R8**，复用 `Colin4k1024/codex#2/#3/#19/#20/#21` 的结论。

### 范围
- **并发（C1.1–C1.12）**：peer chat 并发 turn（`_sessionsWithActiveTurn` 是 per-session 的 chat URI 集合）、`listSessions` 突发合并与 epoch/trailing-computation 语义、`resolveChatState` 单 peer 合并且原子发布、`_modelRefreshSequencer` 串行与"跟随最新排队 refresh"、连接启动 vs 取消（`_connectionGeneration` + `raceCancellationError`）、代理 token 轮换的在途请求语义、refcount 与 managed working directory 回收、**proxy 子进程所有权不变量（C1.10）**、MCP 清单刷新合并、user-config 版本检查写入串行化与有界重试
- **崩溃（C2.1–C2.7）**：app-server 子进程 SIGKILL、Agent Host utility process 崩溃、Renderer 强杀、`turn/start` 已发出未收 result 时崩溃（→ `uncertain`）、`item/completed` 已收未落盘时崩溃、sandbox tmpdir 泄漏、`_markChatBacking` 之前崩溃
- **恢复（C3.1–C3.12）**：host 重启后的元数据/历史/图片附件/peer catalog 存活（部分已有 capture）、catalog-only peer 直到 resolver 成功、不抢别的客户端的 writer lock、首次 send 才 resume、跨 ChatGPT app ↔ VS Code handoff、分页 thread 恢复中途重启、`sourceUnresolvable` vs `providerUnavailable` 的分别报告与 parking 语义、**单次失败不得当作不存在的证据**、**客户端只把成功返回当权威**（失败不得变成删除 delta）、`chat.agentHost.sessionCatalog.enabled` 回滚杆的冻结与重启语义
- **背压（B8 / R8）**：`-32001 "Server overloaded; retry later."` → 指数退避 + jitter + 有界重试次数 + 用户可见"暂时繁忙"；**禁止**立即密集重试、**禁止**当永久失败
- **连接替换（B7）**：`CodexConnectionReplacedError` → `generation` 不匹配的迟到结果被丢弃、`_disposeConnectionResources(ready)` 被调用
- **进程清理（D16 / A1.4）**：`turn/interrupt` 与窗口关闭后 `pgrep -f 'codex app-server'` 为空；Windows 无即时 terminate 路径时按"有界停止"报告 `cancelling` 直到确认退出（`Colin4k1024/codex#2` H02 / `#21` H21 的结论）
- **资源泄漏**：sandbox tmpdir（B21）、`_releasedManagedWorkingDirectories`、`_desktopRolloutPrefixLimiter` / `_coldSessionReadLimiter` 的 Limiter 队列、`_activeClientHandles`

### 非目标
- 不做混沌工程 / 长时间稳定性 soak（可另开）
- 不改协议
- 不实现新的恢复机制（只验证既有的）
- 不做 Windows 全平台实测（首版聚焦 macOS，Windows 以 unit + 文档化的有界停止策略覆盖）

### 依赖
D01、D02。

### 回滚
纯测试资产 + 必要的最小修复（若验证发现 bug，修复单独提交并标注）。

### 验收标准
1. **A1.4 / D16（最高优先）**：`turn/interrupt` 后轮询断言 (a) AHP `activeTurn === undefined` (b) 子进程已退出或处于明确记录的 `cancelling` 态。**"进程在运行但状态已 cancelled" 不得出现**（`Colin4k1024/codex#2` 的禁止项）
2. **C2.4**：在 `turn/start` 已发出但未收到 result 的时刻 kill Agent Host → 恢复后该 turn 为 `uncertain`；断言**没有**把 JSON-RPC request id 当持久化幂等键（`Colin4k1024/codex#3` 的结论）
3. **C2.1 / B5**：kill `codex app-server` 子进程 → (a) 进行中的 turn 进入终态 (b) `activeTurn` 清空 (c) **所有 pending server request 被 resolved/清理**（A3.1 联动）(d) 已流式内容保留 (e) 下次操作能重建连接
4. **C2.2**：kill Agent Host utility process → Renderer 收到 `onDidProcessExit {code, signal}`，**Renderer 不崩**，重启后走 C3 恢复
5. **C2.3 / D16**：强杀窗口 → `pgrep -f 'codex app-server'` 为空；sandbox tmpdir 无泄漏
6. **B8 / R8**：mock app-server 返回 `-32001` → 断言重试间隔呈指数增长且有 jitter、重试次数有上界、最终给用户可操作提示；断言**没有**在 100ms 内发出 >3 次重试
7. **B7**：触发连接替换 → 断言旧 generation 的迟到 result 被丢弃（用可控延迟的 mock），`_disposeConnectionResources` 被调用一次
8. **C1.10（proxy 子进程所有权）**：断言任何持有 `baseUrl`/`nonce` 的子进程在 proxy handle dispose **之前**被 kill；负向：若顺序颠倒，测试必须失败
9. **C1.4**：模拟 10 个窗口并发 `listSessions()` → 断言只有 1 次 registry 遍历（计数器）；中途 mutation → 断言推进 epoch、不移除进行中计算、后到者共享 1 次 trailing 计算、每个 caller 拿到独立数组、无 caller 递归跟随超过一个计算
10. **C1.6**：并发触发 `_refreshModels` → 断言 sequencer 串行；`_resolveRestoredModel` 在认证排入更新 refresh 时**跟随最新**直到 idle
11. **C3.11（数据安全关键）**：mock `listSessions()` reject → 断言客户端**保留**上次成功快照；mock 返回 `[]` → 断言快照被清空。**传输/认证/catalog 失败不得变成删除 delta**
12. **C3.9 / C3.10**：构造 `providerUnavailable` 与 `sourceUnresolvable` 两种情形 → 断言分别报告；`sourceUnresolvable` 的 session 被 park（不 tombstone、不清 `payloadDirty`、内存态、重启后各重试一次再 park）
13. **C3.12**：`chat.agentHost.sessionCatalog.enabled` 首次读取后运行中改值 → 断言 store backing 不变；改动需重启；关闭时无 catalog import、无后台修复、registry 身份与兼容写不受影响、verification marker 被清空
14. **C1.1 / C1.2 / C1.3**：peer chat 并发 turn 各自正确（已有 capture `two-peer-chats-*`，断言扩展到并发 turn）
15. **B27**：两个窗口操作同一 thread → 只读路径不冲突、写路径不静默丢 turn
16. 资源泄漏：跑 20 轮 create/dispose 循环后，`_sessions` / `_sessionIdByChatUri` / `_sessionIdByThreadId` / `_activeClientHandles` / `_releasedManagedWorkingDirectories` 全部回到空（或断言其上界）
17. `codexAppServerClient.test.ts` / `codexPrewarmEviction.test.ts` / `codexThreadCoordination.test.ts` 全绿 + 新增用例

---

## D14 [P2] 上游同步与版本升级 runbook + CI 门禁

标签：`codex-desktop` `P2` `area:quality` `area:packaging`

### 目标
让 fork 能**安全跟随** microsoft/vscode 与 openai/codex 的上游，避免 R2（漂移）与 R3（协议偏斜）。修掉 **G15**。

### 范围
- **上游基线记录**：`microsoft/vscode` 的跟踪分支与当前 HEAD（`fb20064c0f4`，仓库共 165,607 commits）；`openai/codex` 的 pin（0.153.0）。**复用 `grok-code-product` 已有的 `UPSTREAM_COMMIT` + `VERSION` 双文件 pin 机制与 `sync-upstream.sh`**，而非新发明
- **薄覆盖层策略（对齐 R2）**：明确哪些改动必须是"覆盖层"（`product.json` mixin、configurationDefaults、构建配置、CI workflow、`.agents/research/` 文档），哪些允许改源码。目标是让自有改动的**文件数与行数最小**，使 rebase 冲突面可控
- **Codex 版本升级 runbook**（对齐 R3），必须是**原子三件套**：
  1. 改 `build/codex/codex-version.txt`
  2. 改 `build/agent-sdk/agents/codex/package.json` + 其 `package-lock.json`（`npm install --package-lock-only --ignore-scripts`）
  3. 改根 `package.json` devDependencies + 根 `package-lock.json`
  4. `npm run codex:gen-protocol` 重生成 828 个文件
  5. `npm run codex:check-protocol-sync` 必须绿
  6. `npm run test-agent-host-e2e` 全量 replay 必须绿
  7. 若有 capture 因协议变更失效 → 用 `AGENT_HOST_UPDATE_AHP_SNAPSHOTS=1` 更新 AHP 快照，**逐项人工 review diff**（不能盲更）
  8. `build/agent-sdk/test/versionSync.test.ts` 必须绿
  - 上述 1–4 必须在**同一提交**（现有 `817a8d156d9 agentHost: update bundled Codex SDK to 0.153.0` 是参考样例）
- **VS Code 上游 rebase runbook**：频率、冲突高发区（`src/vs/platform/agentHost/`、`src/vs/sessions/`、`product.json`、`package.json`）、rebase 后的必跑门禁（compile + hygiene + eslint + agent-host 单测 + replay e2e + `check-clean-git-state.sh`）
- **CI 门禁清单**：把 D11/D12/D13 的守卫 + `codex:check-protocol-sync --if-changed` + `versionSync.test.ts` + hygiene/eslint/stylelint 组成 PR 必过集合
- **漂移监控**：定期（如每周）跑一次上游 diff 报告，统计 `src/vs/platform/agentHost/node/codex/` 与 `src/vs/sessions/` 的上游改动量，作为 rebase 优先级输入
- **`scripts/sync-agent-host-protocol.ts`** 的用途与是否纳入 runbook

### 非目标
- 不做自动化 rebase / 自动升级机器人
- 不追上游的每个 commit
- 不改上游代码
- 不做多版本并存支持

### 依赖
D02、D11。

### 回滚
纯文档 + CI 配置。

### 验收标准
1. `UPSTREAM-SYNC.md` 存在，含 Codex 升级 runbook 的 8 步与 VS Code rebase runbook
2. **实操验证**：按 runbook 完成一次真实的 Codex 小版本升级（例如 0.153.0 → 0.153.x 或 → 0.155.1），全部门禁绿，PR 为单一原子提交
3. `codex:check-protocol-sync --if-changed --base <ref>` 在只改无关文件的 PR 上**跳过**（退出 0），在改 `protocol/generated/` 或 `codex-version.txt` 的 PR 上**执行**
4. `build/agent-sdk/test/versionSync.test.ts` 在四处版本不一致时失败（负向）
5. 薄覆盖层清单存在：列出所有自有改动文件，并对每个标注"覆盖层 / 源码改动"；源码改动项必须给出**为什么不能用覆盖层**的理由
6. CI 必过门禁清单存在且在 GitHub Actions 上实际生效（不是 workflow_dispatch）
7. 漂移监控 job 产出一次报告，含 `agentHost/node/codex/` 与 `sessions/` 的上游改动量统计
8. rebase 后的必跑门禁全部执行过一次并记录耗时
9. `UPSTREAM_COMMIT` + `VERSION` pin 文件存在（沿用 `grok-code-product` 格式），`sync-upstream.sh`（或移植后的等价物）能跑通一次 dry-run
10. 自有改动面统计存在：相对上游的文件数与行数，且与 D09 验收 12（patch 数为 0）一致

---

## D15 [P2] 扩展市场与生态可用性

标签：`codex-desktop` `P2` `area:packaging`

### 目标
让出厂 app 能安装扩展。修掉 **G9**。

### 范围
- 裁定 gallery：Open VSX（`open-vsx.org`，Eclipse Public License 2.0 的注册表，VSCodium 采用）/ 自建 registry / 不提供
- `product.json.extensionsGallery` 字段填充（`serviceUrl`、`itemUrl`、`resourceUrlTemplate`、`controlUrl` 等；需核对 `src/vs/base/common/product.ts` 的 `IProductConfiguration` 定义）
- 与 D10 联动：MS Marketplace 的 ToS 限官方产品，**不得**指向
- `sessionsWindowAllowedExtensions`（当前 `[]`）的白名单策略：Agents 窗口允许哪些扩展（对齐 D07 的形态裁定）
- `builtInExtensions` 的处置（与 D08 交叉）：`ms-vscode.js-debug` / `js-debug-companion` 带 sha256 与 publisher 元数据，从 `github.com/microsoft/*` 拉取 → 是否自托管镜像
- 扩展签名/信任：`extensionsTrust` 相关配置、workspace trust 与本产品的默认策略
- 内置扩展清单裁定：`extensions/` 下 100+ 个内置扩展，哪些保留（语言/主题/基础功能）、哪些依赖外部服务需评估
- `.vscode-test.js` 与扩展测试在 gallery 变更后的可用性

### 非目标
- 不自建 gallery 服务端
- 不做扩展付费/私有分发
- 不改扩展 API（`vscode-dts`）
- 不做扩展的自动更新策略调优

### 依赖
D09（打包）、D10（合规裁定，特别是 Marketplace ToS 与 Open VSX 义务）。

### 回滚
`product.json.extensionsGallery` 移除即回到"无市场"（仍可通过 VSIX 本地安装）。

### 验收标准
1. 出厂产物中 Extensions 视图能搜索、安装、启用一个真实扩展（如一个 MIT 许可的语言扩展），无需手动 VSIX
2. gallery 请求的目标域名在 **D1 网络出口白名单**内，且与 D10 的裁定一致
3. **不**出现对 MS Marketplace 的任何请求（D1 断言）
4. 安装扩展后重启，扩展仍启用且状态持久（`<dataFolderName>` 下的 extensions 目录正确）
5. `sessionsWindowAllowedExtensions` 的白名单内容被显式裁定并文档化；Agents 窗口中未列入的扩展不激活（有断言，防止意外扩大）
6. Workspace trust 的默认策略被裁定；`--disable-workspace-trust` 仍可用于自动化
7. `builtInExtensions` 的处置有结论；若自托管镜像，sha256 校验通过
8. D10 的 checklist 中 Marketplace / Open VSX 条目被本 Issue 落地并勾销

---

## D16 [P2] 未接线 Codex 能力评估

标签：`codex-desktop` `P2` `area:agentHost`

### 目标
对 `codex app-server` 已提供但 VS Code 侧**未接线**的能力做一次系统评估，产出"接入 / 延后 / 不做"的裁定与代价估算。修掉 **G11**（仅评估，不实现）。

### 范围（逐项调研 + 裁定，**不写实现代码**）
| 能力 | codex 侧位置 | VS Code 侧现状 | 需评估 |
|---|---|---|---|
| Realtime / 语音 | `codex-rs/realtime-webrtc`、`voice-host`、`app-server` 的 `thread/realtime/*`（生成物里有 `ThreadRealtimeStartParams` 等） | `node/codex/**` grep 无 `realtime`/`voice` | 是否做语音输入/输出；WebRTC 在 Electron utility process 的可行性 |
| Cloud tasks | `codex-rs/cloud-tasks`、`cloud-tasks-client`、`cloud-tasks-mock-client` | 无 | 是否暴露云端任务；与 Copilot cloud agent 的重叠 |
| Apps / Connectors | `codex-rs/connectors`；`app/list`、`app/read`、`app/installed`、`app/list/updated` | 无（只有 `codexGuardianReview.ts` 提到 connector） | `$<app-slug>` + `mention` input item 的 UI；`appMetadata` / `branding` / `labels` 渲染 |
| Memories | `codex-rs/memories` | 无 | 记忆的管理 UI 与隐私边界 |
| Code mode | `codex-rs/code-mode{,-host,-protocol,-runtime}`；`--code-mode-host URL` | 无 | 远程 code-mode host 的价值；`deferLoading` 动态工具 |
| Attestation | `attestation/generate`（server→client） | `requestAttestation: false`（`codexAgent.ts:2541`） | **是否影响 ChatGPT 后端可用性**（README：若无客户端 opt-in，app-server 省略 `x-oai-attestation`）→ 这是 D03/D05 的潜在风险，优先评估 |
| `currentTime/read` | `[features.current_time_reminder]` + `clock_source = "external"` | 无 | 时间提醒功能是否需要 |
| Dynamic tools | `item/tool/call` + `dynamicTools` on `thread/start` | 已部分实现（`dynamicToolResponseFromResult`） | 覆盖度与缺口 |
| Worktree（codex 侧） | `codex-rs/worktree`；`Add managed worktree creation to TUI session commands`（`f6976ab03`） | VS Code 有自己的 `IAgentHostWorktreeIsolation` | 两者关系，是否复用 |
| Skills 生态 | `codex-rs/skills`；`skills/list`、`skills/changed`、`skills/extraRoots/set`、`skills/config/write` | `codexCustomizations.ts` 已做发现 | `skills/changed` 失效信号与 `extraRoots/set` 是否已接 |
| Hooks | `codex-rs/hooks`；`hooks/list` + `hooks.state` via `config/batchWrite` | `codexCustomizations.ts` 的 `codexHooksToContainers`；`8324aca6303` 稳定化 trusted workspace hooks | trust 状态 UI（`currentHash` / `trustStatus`）覆盖度 |
| Plugins / Marketplace | `codex-rs/plugin`、`core-plugins`；`plugin/list`、`plugin/installed` | `codexClientCustomizations.ts` | 官方 marketplace 身份 vs 自有 |
| Guardian / auto-review | `codex-rs/guardian-context`；`approvals_reviewer = "auto_review"`、`item/autoApprovalReview/*` | `codexGuardianReview.ts` | 覆盖度与是否暴露给用户 |
| Otel trace websocket | `codex-rs/otel-trace-websocket` | `codexTelemetryOverrides` 强制 none | 是否需要可观测性面板 |
| Responses API proxy | `codex-rs/responses-api-proxy` | VS Code 有自己的 `codexProxyService` | 是否可用 codex 自带的替代 |
| 其他 crate | `agent-graph-store`、`agent-identity`、`agent-roles`、`attachment-store`、`external-agent-migration`、`install-context`、`lmstudio`、`ollama`、`mxc-sandbox`、`network-proxy`、`process-hardening`、`secrets`、`keyring-store`、`workload-identity`、`aws-auth`、`thread-manager-sample`、`v8-poc` | 未评估 | 逐项一句话裁定 |

- 每项产出：**价值 / 代价（人日）/ 依赖 / 风险 / 裁定（接入 P0-P2 / 延后 / 不做）**
- 特别标注 **attestation** 是否会影响 D03/D05 的 ChatGPT 认证可用性 → 若是，升级为 P0 并回灌 D03

### 非目标
- **不实现任何能力**（纯评估）
- 不改 codex 仓库
- 不做用户调研 / 市场分析

### 依赖
D03、D05（认证与 provider 策略定稿后才能判断哪些能力有意义）。

### 回滚
纯文档。

### 验收标准
1. `CAPABILITY-GAP.md` 覆盖上表**全部 17 行**，每行含价值/代价/依赖/风险/裁定
2. **attestation 有明确结论**：`requestAttestation: false` 是否影响 ChatGPT 后端的 `x-oai-attestation` 转发，进而影响自有 app 的可用性；若影响 → 开一张 P0 Issue 并回灌 D03/D05
3. 每项"接入"裁定都标注了它需要触碰的文件与预估 LOC 量级（用于排期）
4. 剩余 crate 清单（`agent-graph-store` 等 17 个）各有一句话裁定
5. 与 `Colin4k1024/codex#1–#29` 的能力做**交叉标注**：哪些能力是 harness 项目会带来的、不应在本产品重复实现
6. 裁定结果被 Epic（D00）的 backlog 吸收，形成下一轮 Wave
