# D02 — Codex 二进制供给与协议版本锁（CODEX-SDK-SUPPLY）

> Issue：Colin4k1024/vscode#4（Part of #1）。日期：2026-09-19。
> 本文是验收标准 10 所要求的 runbook：三级解析链、版本策略裁定、自托管分发、升级代价。

## 1. 三级解析链（运行时）

`codexAgent.ts:_resolveSdkRoot`（:2436）实现、`agentSdkDownloader.ts:loadSdkRoot`（:367）配合：

| 级 | 条件 | 行为 | 日志标志（实测） |
|---|---|---|---|
| 1a | `VSCODE_AGENT_HOST_CODEX_SDK_ROOT` 已设 | 直接返回该路径，**不做任何校验/下载** | `[AgentSdkDownloader] codex: using dev override at <path>` |
| 1b | `product.agentSdks.codex = {version, urlTemplate}`（出厂配置） | cache 命中（`.complete` sentinel）→ 直接用；cache miss → 从 `urlTemplate`（`{sdkTarget}` 替换后）下载、解包、写 sentinel | `cache hit at <cacheDir>`（**trace 级**，默认 info 日志不出现）/ `cache miss for version <v> (<target>); a download is required` → `downloading from <url>` |
| 2 | 前两者皆无（源码 checkout） | dev fallback：由 `node_modules/@openai/codex/package.json` 反推仓库根 | `[Codex] resolving SDK from repo node_modules (dev fallback): <root>` |
| 3 | 都没有 | 交给 downloader 抛可诊断错误 | `Cannot load codex SDK: no \`product.agentSdks.codex\` configured and no VSCODE_AGENT_HOST_CODEX_SDK_ROOT dev override set.` |

（`loadSdkRoot` 在 `agentSdkDownloader.ts:343`；`isAvailable` 在 :292 = env override ‖ (product 配置 ∧ 有 target)。）

优先级：**env override > 出厂配置（缓存/下载）> dev fallback > 报错**。最终二进制路径恒为 `<root>/node_modules/@openai/codex-<platform>-<arch>/vendor/<rust-triple>/bin/codex`，spawn 前 `fs.accessSync(X_OK)` 校验（`codexAgent.ts:2478-2483`，throw 在 :2482）。

> 脚注：issue #4 验收 1 写的 `npm run codex:check-protocol-sync` 在本仓库中不存在——真实脚本名是 `npm run codex:check-protocol`（`package.json` scripts），本文全文使用后者。

## 2. 版本策略裁定：**(a) 保持 0.153.0**

三选项（issue #4 范围）：

| 选项 | 内容 | 判定 |
|---|---|---|
| **(a) 保持 0.153.0** | 827 个生成 .ts 协议文件（另含 1 个跨重生成保留的手写 README.md，合计 828）、103 个 replay capture、`agents/codex` pin、根 devDep、`codex-version.txt` 完全一致（见 §5 证据） | ✅ **采用** |
| (b) 升级到 0.155.x | 需原子三件套 + 全量重生成 + replay 全绿（成本见 §4） | 留给 D14 的升级 runbook 首次实操 |
| (c) 跟 `/poc/codex` main | `0.0.0-dev` 无版本自证，check-protocol-sync 无法锁定 | 否决 |

理由：D01–D13 的全部验收都建立在当前 pin 的一致性上；在没有功能缺口的情况下（本 Epic 未接线能力的评估归 D16），提前升级只增加回归面。升级的触发条件：上游协议出现本产品需要的能力（D16 裁定后）、或安全修复。

## 3. 自托管分发（出厂构建）

机制（本 PR 落地的唯一代码改动）：`build/agent-sdk/common.ts` 的 `buildCdnUrl` / `buildCdnUrlTemplate` 读取 **`AGENT_SDK_CDN_BASE`**（默认 `https://main.vscode-cdn.net`，即上游行为不变）。设置后：

- `produce.ts` 盖进 `product.agentSdks.codex.urlTemplate` 的就是自有域名（`https://<自有域>/agent-sdk/codex/<版本>/{sdkTarget}.tgz`）；
- `uploadOne` 报告的 URL 同源；上传本体用你自己的 `AZURE_STORAGE_ACCOUNT`（`$web` 静态容器）即"自有对象存储"；非 Azure 存储用 `package.ts` 产 tarball 后自传，保持内容寻址路径 `agent-sdk/<sdk>/<版本>/<target>.tgz` 不变；
- 约束（内容寻址纪律）：**永不覆盖**已发布的 `<版本>/<target>.tgz 字节**；要换内容就 bump 版本。`uploadOne` 的 HEAD-then-decide（同 sha 跳过 / 异 sha fail-loud）依赖此纪律；
- macOS Universal 前提：所有平台 job 的 `AGENT_SDK_CDN_BASE` 必须相同，保证各 job 盖出的 `urlTemplate` 完全一致（`{sdkTarget}` 运行时替换）。

平台 SKU（`getSdkTargetForBuild`，与 SDK 的 npm `optionalDependencies` 约定同步）：`darwin-{arm64,x64}` / `linux-{x64,arm64}`（静态 musl 单一 SKU，`hasSeparateMuslLinuxPackage: false`，Alpine 同 `linux-*`）/ `win32-{x64,arm64}`；`web`/`armhf` → undefined。rust triple 由 `codexBinaryTriple()` 映射（darwin-arm64 → `aarch64-apple-darwin`，tarball 内 `vendor/<triple>/bin/` 实测命中）。

`verifyStagedTree` 对 codex：无 `main` → 跳过 import 探针（agent host 从不加载 tarball 内 JS）；`listPlatformBinaries` 命中 `vendor/<triple>/bin/` 下每个二进制并断言 present + non-empty + executable；chmod 与断言同源（不可能不一致）。实测：A9 tarball 解包含 `codex` + `codex-code-mode-host` 两个二进制（见 §5）。

## 4. 升级到新版本的原子流程（将来执行时严格照此；D14 会展开为完整 runbook）

1. 改 `build/codex/codex-version.txt`
2. 改 `build/agent-sdk/agents/codex/package.json` + 其 `package-lock.json`（`npm install --package-lock-only --ignore-scripts`）
3. 改根 `package.json` devDependencies + 根 `package-lock.json`（`npm install`）
4. `npm run codex:gen-protocol` 全量重生成 827 个 .ts 文件
5. `npm run codex:check-protocol` 必须绿
6. `npm run test-agent-host-e2e`（103 capture）必须绿；协议变更导致的快照差异用 `AGENT_HOST_UPDATE_AHP_SNAPSHOTS=1` 逐项人工 review
7. `cd build && npm test`（versionSync 三处一致必须绿）
8. **1–4 必须同一提交**（revert 原子）；参考样例：上游 `817a8d156d9`（0.153.0 升级）

负向保障（实测，见 §5 B3）：pin 与二进制不一致时 `codex:gen-protocol` 在生成任何文件之前失败并打印实际/期望版本。

## 5. 证据日志（2026-09-19，分支 codex-desktop/d02-sdk-supply）

| 验收 | 证据 |
|---|---|
| 1 协议同步绿 | `npm run codex:check-protocol` → `✓ Codex protocol client matches ... 0.153.0`（D01 起 CI 亦在跑） |
| 2 负向 B3 | 临时把 `codex-version.txt` 改为 0.999.0 → `codex:gen-protocol` **EXIT=1**：`Version mismatch: binary is 0.153.0, pinned is 0.999.0.` + 修复指引；版本文件已还原 |
| 3 dev 路径 | D01 证据：`[Codex] resolving SDK from repo node_modules (dev fallback): /Users/…/vscode`（零 env override） |
| 4 二进制 X_OK | `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`（-rwxr-xr-x，220452192 bytes）；spawn 前校验代码 `codexAgent.ts:2478-2483`（accessSync :2480） |
| 5 出厂下载+缓存+断网 | **契约级**：`agentSdkDownloader.test.ts`（6492 项单测的一部分）覆盖 cache miss→download→sentinel、cache hit 免下载、并发去重、rename-loser、取消清理（其单测用本地 HTTP server 驱动真实下载路径）。**完整性模型（如实声明）**：运行时 downloader **没有** sha/digest 校验——完整性 = HTTPS 传输 + 内容寻址路径（`agent-sdk/<sdk>/<版本>/<target>.tgz`，版本即内容身份）+ 构建侧 `sha256OfFile` 记入 blob metadata（供审计比对）+ 解包完成后才写 `.complete` sentinel（`.complete` 的存在即完整性信号，中途崩溃的解包不会命中缓存）。**对 issue #4 验收 5 的显式偏差**：原文期望"sha256 校验通过"，当前架构下运行时不可演示；若需真正的逐下载哈希校验，须上游为 `IAgentSdkProductConfig` 增加哈希字段（另开 upstream issue 的候选，不在本 PR 范围）。**端到端实机**（product 配置 → 下载 → 断网二次启动）触发方式：启动探测有 SDK-locality 门控（`isSdkResolvableWithoutDownload` 仅在 override 或 sentinel 存在时为真）不会自动下载；由**显式 Download 入口**（`agentSdkSetupChannel.ts:26 downloadSdk()`）或首次创建 Codex 会话触发——实机验证归入 D03/D04 的联合冒烟验收（issue #5/#6 验收 1），此处显式登记为移交项，非已完成 |
| 6 env override 优先 | 实测：`VSCODE_AGENT_HOST_CODEX_SDK_ROOT=/tmp/d02-override` 启动 → `[AgentSdkDownloader] codex: using dev override at /tmp/d02-override` + `[Codex] spawning app-server from /tmp/d02-override/node_modules/...`（优先于 dev fallback） |
| 7 负向 B1 | 实测：override 二进制 `chmod -x` → 启动 → `[warning] [Codex] startup account probe failed: Codex binary not executable: <path> (EACCES: permission denied…)`，**应用存活无崩溃**。注册语义（如实订正）：注册门控是 `!isBuilt || isAvailable`（`agentHostMain.ts:175`），而 `isAvailable`（`agentSdkDownloader.ts:292`）= env override ‖ (product 配置 ∧ 有 target)，**与二进制是否可执行无关**——因此出厂构建配置了 `product.agentSdks.codex` 时 B1 同样会注册；provider 不注册只发生在"既无 override 又无 product 配置"时（即 B2 场景）。B1 的可验收行为因此是：Codex 不可用 + 错误可诊断 + 无崩溃（实测均满足），而非"不注册" |
| 8 负向 B2 | 契约级已有：`agentSdkDownloader.test.ts:446`（`no \`product.agentSdks.*\` configured` actionable error）+ `agentSdkDownloadTelemetry.test.ts`（notConfigured 分类）。migration-deferred / 聚合 listing 不阻塞的行为由既有 e2e capture 覆盖 |
| 9 tarball 产出 | `node build/agent-sdk/package.ts --sdk=codex --target=darwin-arm64 --out=/tmp/d02-out` → `codex-0.153.0-darwin-arm64.tgz`（115613316 bytes，sha256=8eb8d05e…，verifyStagedTree 内建通过）；解包含 `vendor/aarch64-apple-darwin/bin/{codex,codex-code-mode-host}` |
| 10 本文档 | 即验收 10 |
| 版本一致性 | `cd build && node --test agent-sdk/test/versionSync.test.ts` 绿（遍历 `getSdks()`=claude+codex：agents pin = 根 devDep = lockfile 三处一致）；本 PR 新增 `cdnEndpoint.test.ts`（默认端点 / env 重定向 / 尾斜杠与非 http 回退） |

## 6. 代码改动清单（薄覆盖）

- `build/agent-sdk/common.ts`：新增 `cdnBase()`（读 `AGENT_SDK_CDN_BASE`，默认不变）；`buildCdnUrl/Template` 改用之
- `build/agent-sdk/test/cdnEndpoint.test.ts`：新增 3 用例
- `build/agent-sdk/README.md`：新增 "Self-hosted distribution (forks)" 章节
- 本文（`.agents/research/codex-desktop/CODEX-SDK-SUPPLY.md`）

上游行为零变化（不设 env 时字节等价；**env 设了但非法时 fail-loud 抛错**，不会静默回退）；rebase 冲突面：common.ts 两个函数体。

**重定向范围（重要边界）**：`AGENT_SDK_CDN_BASE` 只影响 agent-SDK 管线。仓库内其他对 `main.vscode-cdn.net` 的硬编码引用——dictation-runtime、sourcemaps、copilot BYOK（`extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts:111`）——不在本机制覆盖内，D08 的 D1 出口白名单验收需单独处理。另：macOS Universal 场景"所有平台 job 的 `AGENT_SDK_CDN_BASE` 必须同值"目前仅是文档纪律（§3），构建期断言（produce.ts 汇总时比对各 job urlTemplate）登记为 D09 可选加固。
