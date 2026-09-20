# D08 决策记录 — Copilot 依赖与第三方遥测出口隔离（Issue #10）

> 实施分支：`codex-desktop/d08-telemetry-isolation`。每项裁定编号 D08-NN，供 D10
> （LICENSE-CLEARANCE）与 D09（打包流水线）引用。调研依据：
> `00-FINDINGS.md`、`01-ACCEPTANCE-CORE.md`、`LICENSE-CLEARANCE.md`（D10）。

## D08-01 extensions/copilot：保留源码、默认禁用、打包期硬阻断（裁定 a）

- **裁定**：采纳规格选项 (a)——`extensions/copilot` 保留在仓库内（开发自用构建合法，
  D10 §5："development purposes only" 恰好覆盖自身开发调试），不打进对外产物。
- **理由**：(b)/(c) 需要改造 `compile-copilot` 工具链（package.json scripts、
  `build/gulpfile.extensions.ts`、`.vscode-test.js`），首版不值；且 copilot 扩展的
  打包剥离由 D09 流水线统一把关更合理。
- **硬阻断钩子**：`scripts/check-no-copilot-artifacts.sh <artifact-dir>` —— D09 的
  verify-beta-gates 必须对每个打包产物目录调用它；任一产物含
  `extensions/copilot`、`node_modules/@vscode/copilot-api`、`node_modules/@github/copilot*`，
  或 product.json 残留 `defaultChatAgent` / `vscode-cdn.net`，即非零退出。
- **已知限制**：`npm run compile` 仍包含 `compile-copilot`（源码保留的必然结果）。

## D08-02 product.json.defaultChatAgent：移除（删除字段）

- **裁定**：出厂 product.json 不含 `defaultChatAgent`（extensionId=GitHub.copilot +
  30 个 aka.ms 链接整体移除）。
- **落地**：mixin 覆盖层 `product/product.json` 设 `"defaultChatAgent": null`；
  `scripts/apply-mixin.sh` 新增 **null-即删除** 合并语义（spread 无法表达删除），
  上游 product.json 保持 0 diff（`check-product-json-pristine.sh` 不变）。
- **下游消费者核对**（`defaultChatAgent` 类型改为可选，tsc 全量比对 origin/main
  基线 0 新增错误）：
  - 已有守卫（无需改）：`configurationRegistry.ts`、`chatEntitlementService.ts`、
    `chatGettingStarted.ts`、`languageModelToolsContribution.ts`、
    `mainThreadLanguageModelTools.ts`、`chatSetup*.ts`、`cloudSandboxApiService.ts` 等。
  - 本轮加固：`extensionGalleryService.ts`（查询重排 + deprecated 映射两处）、
    `abstractExtensionManagementService.ts`（pack 卸载保护）、
    `extensionsWorkbenchService.ts`（卸载保护）、`chatWidget.ts`（欢迎语 TOS）、
    `agentSessionsWelcome.ts`（隐私告知卡）、`chatStatusDashboard.ts`（补全/NES
    设置区整体跳过）、`chatStatusEntry.ts`（设置监听）、
    `defaultAccount.ts`（无 defaultChatAgent 时不注册 Copilot 默认账号 provider，
    `getDefaultAccount()` 立即 resolve null，认证 provider 回退内置 github）。
  - `src/vs/platform/product/common/product.ts` 的 web 缺省 product 同步移除
    `defaultChatAgent`（否则 GitHub.copilot 引用仍进 bundle）。

## D08-03 builtInExtensions（js-debug 等）：保留

- **裁定**：保留 `ms-vscode.js-debug*` 三项（D10 §7：全部 MIT，sha256 pin 不变）。
- **跟进项**：自托管镜像（消除对 github.com 发布工件的构建期依赖）记入 backlog，
  归 D09 打包流水线评估；非发布阻断。

## D08-04 webviewContentExternalBaseUrlTemplate：删除字段

- **裁定**：出厂配置不得出现 vscode-cdn.net。
- **缺省行为核对结论**：桌面端（Electron）的 webview 端点是本地
  `vscode-webview://{{uuid}}` scheme（`environmentService.ts` electron-browser 覆盖），
  删除字段即"默认本地行为"。**注意**：browser 版 `environmentService.ts` 的代码级
  fallback 仍硬编码 vscode-cdn.net —— 桌面产物不可达；web/远程部署若启用需自配
  `options.webviewEndpoint`，记入 D09/部署注意事项。
- **落地**：覆盖层 `"webviewContentExternalBaseUrlTemplate": null`（null-删除）。

## D08-05 Copilot/Claude provider 默认注册：保留（可选通路）

- **裁定**：`agentHostMain.ts` 的 `CopilotAgent` 注册保留。无凭据时无网络连接：
  Copilot provider 的所有出口（CAPI、copilot-telemetry）都由用户显式登录
  GitHub 后持有的 token 驱动；无 token 时 `codexProxyService` 不会被
  `start()`（token 是 `start(githubToken)` 的强制参数）。
- **断言**：`codexProxyService.test.ts` 新增 AC5 单测——构造不监听任何端口；
  `start(token)` 恰好绑定一个 127.0.0.1 监听；最后一个 handle dispose 后监听关闭。
- **偏离说明**：规格要求"无 token 时 codexAgent 不启动代理"。当前
  `codexAgent._startRawConnection` 以 `this._githubToken ?? ''` 无条件启动 loopback
  代理；修正它需要改 `codexAgent.ts`，而编排者约束本轮 codexAgent 仅可改
  CLIENT_INFO 一处。因此 AC5 落在"绑定被 token 门控 + 不 start 不监听"这一
  可证明不变量上；`codexAgent` 的空 token 调用路径留给后续 issue（编排者决策）。

## D08-06 codexProxyService：绑定 token 门控（见 D08-05 断言）

跟踪 issue：#39（无 GitHub token 时不绑定端口的最强形式；本裁定先落地 token 门控不变量）。

同 D08-05。`codexProxyService.ts` 实现未改（硬约束）。

## D08-07 遥测：telemetryLevel 默认 off + 禁覆盖断言 + 凭据落盘扫描

爆炸半径补充：上游 product.json 无 `enableTelemetry` 键，故无 mixin 的构建（含 web/dev fallback）遥测默认同样翻转为 OFF——对本产品这是意图本身，记录以防误判为回归。

- **产品级默认值**：`telemetryService.ts` 中 `telemetry.telemetryLevel` schema 默认
  改为 `product.enableTelemetry ? ON : OFF`；mixin 覆盖层显式
  `"enableTelemetry": false`（本仓库无第一方遥测管道，首版就是"关掉"）。
  用户显式设置仍生效（`getTelemetryLevel` 读用户值）。
- **AC2 断言**（`codexLaunchConfig.test.ts`）：Agent Host OTel 全开时 spawn args
  仍恒含 `analytics.enabled=false` / `feedback.enabled=false`；且遥测 override 追加在
  用户 extraArgs 之后，用户无法通过 extraArgs 重新开启。
- **AC3 断言**：无 OTel 配置时 `otel.trace_exporter/exporter/metrics_exporter="none"`；
  `otel.log_user_prompt == captureContent ?? false`（含 captureContent=true 用例）。
- **AC4 脚本**：`scripts/scan-credential-residue.sh <userDataDir>` —— 扫描日志 /
  state.vscdb / agent-host.db / settings.json 等落盘面中的明文 token 形态
  （ghp_/gho_/github_pat_/sk-/Bearer …），sqlite 文件额外过 strings(1)。
- **AC1 脚本**：`scripts/audit-network-egress.sh` —— (1) 内存合并
  上游 product.json + 覆盖层，断言出厂配置无 denylist 端点（vscode-cdn.net、
  vortex/1DS/App Insights、exp-tas、copilot-telemetry），且 D08 三项删除生效；
  (2) 非测试源码扫描同一 denylist，命中须由
  `scripts/network-egress-allowlist.txt` 逐条豁免（每条附理由）。
  现状全部命中的豁免理由：1DS appender（无 aiConfig 不实例化）、
  copilot-telemetry（仅用户显式 Copilot 登录可达）、webview/CDN 常量
  （web-only，桌面本地 scheme）、build/agent-sdk 上传工具（维护者工具；
  运行时 URL 来自 product.agentSdks，本产品未配置——**D09 不得指向
  vscode-cdn.net**）。
- **AC1 动态半区**（manual verification，PR 描述步骤）：mitmproxy 下
  (a) 冷启动 (b) 一次真实 Codex turn (c) 打开一个 webview，断言只出现白名单域名
  （api.openai.com / chatgpt.com / 用户自配 MCP / 自有 CDN）。

## 其他范围项核对

- `agentsTelemetryAppName: "agents"`：保留。它只是扩展宿主 telemetry `appHost`
  标签，不是端点；且遥测默认 off。无出口含义。
- `trustedExtensionAuthAccess`：覆盖层收窄为
  `{ "microsoft": ["vscode.github-authentication"] }`（移除 GitHub.copilot-chat 的
  github/github-enterprise 免授权访问）。
- `onboardingKeymaps` / `onboardingThemes`：保留。仅为欢迎页建议的市场扩展 ID，
  不含端点；扩展市场指向归 D15。
- AC6/AC7（npm ci/compile 无 GitHub Packages 凭据）：`extensions/copilot` 的
  `@github/copilot`、`@vscode/copilot-api`、`@github/blackbird-external-ingest-utils`
  在 package-lock.json 中全部 resolved 自 registry.npmjs.org；无
  npm.pkg.github.com 配置（根 `.npmrc` 与 `extensions/copilot/.npmrc` 均无）。
  即裁定 (a) 下 npm ci 不需要 GPR 凭据。
- CLIENT_INFO（附加任务）：`codexAgent.ts` 的 `clientInfo.name` 从
  `vscode_agent_host` 改为 `colincode_agent_host`，title 改为
  `ColinCode Agent Host`（D10 §3：不得伪装微软官方客户端）。全仓库无测试钉住旧值
  （已 grep 验证）。

## 回滚

每项独立 revert：覆盖层四键、`telemetryService.ts` schema 默认、
`defaultChatAgent` 消费者加固集、CLIENT_INFO。脚本与测试为纯新增。
