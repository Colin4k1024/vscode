# D10 许可、商标与再分发合规裁定（LICENSE-CLEARANCE）

> **本文档不构成法律意见。** 它是工程侧的事实清单与选项分析，所有"裁定"都是工程建议，发布前需法务/律师复核（复核条目见 §13）。调研日期：2026-09-19。调研方式：只读（本仓库 `main` @ `fb20064c0f4`、`/Users/jiafan/Desktop/poc/codex` @ main、主工作区 node_modules、`gh api` 拉取 grok-build / grok-code-product、公开网页取证）。
>
> Issue：Colin4k1024/vscode#12（Part of #1）。落地动作归属：D06=#8（产品身份与品牌）、D08=#10（Copilot 依赖与遥测隔离）、D09=#11（打包流水线与 SDK 分发）、D15=#17（扩展市场）、D03=#5 / D05=#7（认证与默认 provider，本文 §4 反向输入）。

## 0. 结论速览（11 项一览表）

| # | 项 | 许可/条款 | 是否阻断对外分发 | 落地归属 |
|---|---|---|---|---|
| 1 | VS Code 源码 vs 产品名/图标/Marketplace | 源码 MIT；名称/图标/Marketplace 非 MIT | **不阻断**（改名换图标后） | D06 #8、D15 #17 |
| 2 | @openai/codex（Rust 二进制） | Apache-2.0 + NOTICE；crate 图无强 copyleft | **不阻断**（保留 NOTICE/许可证 + 声明非官方） | D09 #11、D02 #4 |
| 3 | OpenAI ToS：clientInfo.name | app-server README 要求企业集成联系 OpenAI | **不阻断个人版**；**企业分发前需联系 OpenAI** | D06 #8（改名时换 clientInfo）、D03 #5 |
| 4 | ChatGPT 订阅额度用于自研客户端 | OpenAI 未明确授权第三方分发客户端用订阅 | **个人自用可接受**；**对外分发默认必须 API Key** | 反向输入 D03 #5、D05 #7 |
| 5 | extensions/copilot 三个 SDK 包 | `@vscode/copilot-api` 限 dev-only、禁再分发；`@github/copilot` 限未修改再分发 | **阻断**（只要产物含 copilot 扩展/API 就不得对外分发） | D08 #10 |
| 6 | GitHub MCP server（remote） | GitHub Copilot Terms / GitHub ToS（按用户 token 走） | **不阻断**（服务由用户自己的 GitHub 账号驱动） | D08 #10（无 token 即不注入） |
| 7 | builtInExtensions（ms-vscode.*） | 全部 MIT（js-debug 等） | **不阻断**（保留 sha256 pin 与 MIT 声明） | D09 #11 |
| 8 | Electron / Node / Chromium | MIT / MIT / BSD-3 + ffmpeg LGPL-2.1+ + H.264 专利声明 | **不阻断**（沿用官方 Electron；H.264 见 §8.4 法务复核项） | D09 #11 |
| 9 | 字体与图标（codicon 等） | codicon: MIT(代码) + CC-BY-4.0(字体/图标)；seti: 非商业许可（见 §9.2） | codicon **不阻断**（需署名）；seti 图标**需法务复核** | D06 #8 |
| 10 | Marketplace / Open VSX | MS Marketplace ToS 限官方产品；Open VSX 按扩展各自许可 | **不得指向 MS Marketplace（阻断若违反）**；Open VSX 可用 | D15 #17 |
| 11 | 其他 npm 依赖（非 MIT/Apache/BSD） | 见 §11 抽样清单（1 项 LGPL：jschardet，上游已合规处理） | **不阻断**（跟随上游 notices 机制 + 补充清单） | D09 #11（THIRD-PARTY-NOTICES 生成） |

**整体结论：不存在"完全不可发布"的死锁；但存在 3 个发布门条件**（改品牌、剥离 copilot 扩展、不指向 MS Marketplace），以及 2 个"发布前需法务明确"的高不确定项（ChatGPT 订阅用于分发的客户端、H.264/专利与 seti 图标）。在 D06/D08/D09 完成前，Epic #1 的发布门保持**未通过**；D09 产物在此之前标记"**仅内部使用**"。

---

## 1. VS Code 源码（MIT） vs 产品名/图标/Marketplace（非 MIT）

**许可证与出处**（已真实打开）：
- `LICENSE.txt`（仓库根）：MIT，`Copyright (c) 2015 - present Microsoft Corporation`。关键条款原文："Permission is hereby granted, free of charge, to any person obtaining a copy of this software… to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies"。
- `package.json` `license: "MIT"`；源码树每个文件头 "Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License."

**MIT 覆盖与不覆盖的边界**（VSCodium 公开实践佐证）：
- 覆盖：`src/vs/**`、`build/**`、`extensions/**`（个别扩展有自己 LICENSE）等仓库内容 → 再分发、修改、商用均可。
- 不覆盖：①"Visual Studio Code"名称与 Logo（微软商标；VSCodium 明确不用 VS Code 名称/图标，另起名 + 自绘图标）；②微软官方二进制（含 MS 私有组件与遥测）——所以必须从源码自建（本仓库正是如此）；③Visual Studio Marketplace（见 §10）；④微软发布渠道与更新服务。

**义务清单**：MIT 仅两件——保留版权与许可声明（仓库根 LICENSE.txt + 各文件头随源码自然保留）；在分发物中附 MIT 全文。工程建议：对我们自己的修改可选择 MIT（沿用）或 Apache-2.0（grok-build 先例：其 fork 的 `LICENSE` 为 Apache-2.0, "Copyright 2023-2026 SpaceXAI"，MIT→Apache-2.0 单向兼容），二选一需在 D06 定案。

**是否阻断**：源码本身**不阻断**；若以"VS Code"名义或微软图标分发则**阻断**（R1）。VSCodium 的坑（公开记录）：早期沿用 VS Code 名称/图标被指商标问题后改为 VSCodium + 自绘图标；接入 MS Marketplace 被 ToS 禁止后改用 Open VSX。

**落地动作**：D06 #8（改名 `nameShort/nameLong/applicationName`、`dataFolderName`、`urlProtocol=code-oss` → 自有值、`darwinBundleIdentifier=com.visualstudio.code.oss` → 自有值、替换图标）；D15 #17（gallery 选择）。

## 2. @openai/codex（Apache-2.0）与 Rust 依赖图

**许可证与出处**（已真实打开）：
- `/Users/jiafan/Desktop/poc/codex/LICENSE`：Apache-2.0 全文；附录声明的版权行："Copyright 2025 OpenAI"。
- `/Users/jiafan/Desktop/poc/codex/NOTICE`（保留义务来源）：
  > "OpenAI Codex / Copyright 2025 OpenAI /
  > This project includes code derived from [Ratatui](https://github.com/ratatui/ratatui), licensed under the MIT license. / Copyright (c) 2016-2022 Florian Dehau / Copyright (c) 2023-2025 The Ratatui Developers"

**义务清单**：
1. Apache-2.0 §4(a)–(d)：分发（含二进制）时必须向接收者提供 Apache-2.0 许可证文本；若分发的是修改版，必须在显著位置标注修改；
2. NOTICE 保留：Apache-2.0 §4(d) 原文（codex/LICENSE 第 138 行起）："You may not remove or deviate from or alter any NOTICE notices contained within the Work" —— 必须原样保留上述 NOTICE 全文；
3. **商标条款** Apache-2.0 §6（codex/LICENSE:138）："This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor…" —— "Codex"、"OpenAI" 名称与商标不随许可证授予。产品可用"built on OpenAI Codex technology"式的描述性合理使用（nominative fair use），但不得命名为 "Codex xxx" 或暗示官方出品。
4. 我们分发的形态是 codex 各平台二进制 tarball（D02/#4 pin 版本 + D09/#11 自托管 CDN + sha256）——二进制分发同样落在 §4 义务内。

**cargo deny 等价检查**（验收 2；本机无 `cargo-deny`，未安装，用 `cargo metadata --format-version 1` 解析 + 复刻 `codex-rs/deny.toml [licenses].allow` 的语义）：

- 命令：`cd /Users/jiafan/Desktop/poc/codex/codex-rs && cargo metadata --format-version 1`（exit 0，依赖图 **1457 个 crate**）
- deny.toml allow 列表（`codex-rs/deny.toml`，`[licenses].allow`）：`Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-2-Clause, BSD-3-Clause, BSL-1.0, CC0-1.0, CDLA-Permissive-2.0, ISC, MIT, MIT-0, MPL-2.0, OpenSSL, Unicode-3.0, Unlicense, Zlib`（`exceptions = []`）
- **强 copyleft（GPL/AGPL/LGPL/CDDL/EPL/SSPL 单一许可）crate：0 个。**
- 许可证直方图（前几名）：`MIT OR Apache-2.0` 561、`MIT` 307、`Apache-2.0` 216、`Apache-2.0 OR MIT` 92、`MIT/Apache-2.0`（旧式斜号，spdx 解析按 OR）86、`Unicode-3.0` 30、`Zlib OR Apache-2.0 OR MIT` 20、`BSD-3-Clause` 15、`Unlicense OR MIT` 13、`MPL-2.0` 12（弱 copyleft，deny.toml 显式允许：nucleo、symphonia 系列 MP3 解码、option-ext 等 12 个）。
- 与 allow 列表比对后**剩余不符项（均为宽松许可、非 copyleft）**，真实 `cargo deny check licenses` 会报 3 条：
  | crate | version | license 表达式 | 缺失项 |
  |---|---|---|---|
  | `terminfo` | 0.9.0 | `WTFPL` | WTFPL 不在 allow |
  | `wezterm-bidi` | 0.2.3 | `MIT AND Unicode-DFS-2016` | Unicode-DFS-2016 不在 allow |
  | `finl_unicode` | 1.4.0 | `(MIT OR Apache-2.0) AND Unicode-DFS-2016` | Unicode-DFS-2016 不在 allow |
  说明：WTFPL 与 Unicode-DFS-2016 均为宽松/废弃 SPDX id（无 copyleft 义务）；上游 CI 之所以绿，推测靠 deny 的 clarify 或对该三项的忽略——**这是上游 codex 侧的既有状态，不是我们引入的缺口**。
- 多许可（OR）crate 中出现过 `LGPL-2.1-or-later` 字样的：`r-efi`（`MIT OR Apache-2.0 OR LGPL-2.1-or-later`）、`self_cell`（`Apache-2.0 OR GPL-2.0-only`）——均可用宽松分支满足（deny 语义：任一 OR 分支在 allow 即通过），**不构成义务**。

**是否阻断**：**不阻断**。前提：随分发物附 Apache-2.0 全文 + 原样 NOTICE + crate 许可清单（D19 SBOM / D09 产物内 `THIRD-PARTY-NOTICES`）+ 显著声明"本产品非 OpenAI 官方产品，Codex 是 OpenAI 的商标"。

**落地动作**：D09 #11（打包时把 codex LICENSE/NOTICE/版本号/crate 清单放进产物）；D02 #4（版本 pin 记录，SBOM 输入）。

## 3. OpenAI 服务条款：clientInfo.name 与 Compliance Logs Platform

**出处原文**（已真实打开 `/Users/jiafan/Desktop/poc/codex/codex-rs/app-server/README.md:138-143`）：

> "Applications building on top of `codex app-server` should identify themselves via the `clientInfo` parameter.
> **Important**: `clientInfo.name` is used to identify the client for the OpenAI Compliance Logs Platform. If you are developing a new Codex integration that is intended for enterprise use, please contact us to get it added to a known clients list. For more context: https://chatgpt.com/admin/api-reference#tag/Logs:-Codex"

**本仓库当前值**（grep `src/vs/platform/agentHost/node/codex/`，`codexAgent.ts:158-165`，初始化调用在 `codexAgent.ts:2540`）：

```ts
const CLIENT_INFO = {
	name: 'vscode_agent_host',
	title: 'VS Code Agent Host',
	// The codex `clientInfo.version` is informational. …
	version: '0.1.0',
};
```

**裁定（工程建议）**：
1. `name: 'vscode_agent_host'` 是微软（上游 VS Code 团队）已注册在案的客户端名，**不得继续沿用**对外分发——它会把我们的流量伪装成微软官方 VS Code 客户端进 OpenAI 合规日志（诚实标识问题 + 欺骗性关联风险）。
2. 自有 app 应在 D06 品牌定案时同步改为自有稳定标识（建议 `name` 用 snake_case 产品代号，如 `ourbrand_desktop`；`title` 用产品名；`version` 用 app 版本而非占位 `0.1.0`）。
3. **是否联系 OpenAI**：README 的原文触发条件是 "intended for enterprise use"。结论：①个人/小范围自用——不强制，但改为自有 name 属应尽义务；②对外分发、尤其面向企业——**必须**通过公开渠道联系 OpenAI 把自有 name 加入 known clients（联系要点草稿见 §12，实际联系需单独授权）。

**是否阻断**：改名前**不得对外分发**（沿用他人 clientInfo.name 属不实标识）；改名后不阻断；企业场景需联系。

**落地动作**：D06 #8（品牌定案时改 `CLIENT_INFO`，一行改动 + e2e 快照更新）；D03 #5（认证链路文档同步）。

## 4. ChatGPT 订阅额度用于自研客户端（ToS 评估 → 反向输入 D03/D05）

**取证**（公开来源）：
- OpenAI 帮助中心《Using Codex with your ChatGPT plan》：Codex 包含在各 ChatGPT 套餐中，官方入口是 Codex CLI/Web/IDE 扩展以 ChatGPT 账号登录。
- OpenAI《Terms of Use》（2026-01-01 生效版）"What you cannot do" 含："Modify, copy, lease, sell or distribute any of our Services"（针对 *Services* 本体，即 ChatGPT/Codex 服务，而非开源的 Apache-2.0 CLI 客户端）；以及禁止 "automatically or programmatically extract data or Output"、禁止绕过限流与防护。
- openai/codex discussion #8338（已读全文）：官方维护者（etraut-openai）确认 **fork/修改 codex CLI 是欢迎的**（"welcome to fork the repo and make modifications"，代码 Apache-2.0）；但对"商业第三方 app 用 ChatGPT OAuth 做认证/计费层"的追问**明确拒绝给出法律裁定**（"I'm an engineer, not a lawyer"，建议咨询律师并参考官方 terms）；同时提到 OpenCode 等 OSS 项目在做类似事情，未见表态反对。
- 先例：Cline（2026-01）在第三方产品中自行实现了 Codex OAuth（"Sign in with OpenAI"），无公开的 OpenAI 授权或处罚记录——**无官方背书，也无官方禁止执法记录**。
- codex 的 ChatGPT 登录走 OpenAI OAuth（device code flow），非 API key。

**结论（工程侧判断 + 不确定性声明）**：
- **个人自用**：把 ChatGPT 订阅额度用于**自己构建、自己使用**的 codex CLI/app-server——低风险。理由：代码 Apache-2.0 且官方欢迎 fork；每个订阅者的登录是自己的账号；此即"用户自己的 codex"。
- **对外分发给他人的客户端，把 ChatGPT 登录作为默认/主打认证**：**高不确定性，工程上按"不合规推定"处理**。理由：a) 官方渠道从未授权"第三方分发产品"使用订阅额度（Q&A 被拒答）；b) ToU 禁止 distribute any of our Services 的表述存在被扩大解释的空间；c) 唯一相关先例（Cline）无官方背书。
- **API Key（含 BYOK）**：计费与条款均走 OpenAPI 商业 API 条款，向最终用户分发客户端让用户自带 key 是标准、清晰合规的模式。

**反向输入（对应验收 5）**：
- **D05 #7**：对外分发的默认认证/计费路径必须改为 **API Key（BYOK）**；ChatGPT 订阅登录可作为"实验/个人自用"开关保留，UI 需提示"订阅登录适用于你个人的 ChatGPT 账号；用于分发的商业产品需自行确认 OpenAI 条款"。
- **D03 #5**：ChatGPT 登录一等化照做（修 G4 的 API Key 判 unavailable 也照做），但其产品定位降级为"**仅个人自用**"（README/UI 明示）；不得把订阅登录作为卖点宣传。
- 若法务后续拿到 OpenAI 书面许可（known clients 列表或合作伙伴条款），此裁定可升级。

**是否阻断**：不直接阻断发布（因为有 API Key 兜底），但**绑定了 D05 的默认认证设计**；若绕过该输入直接以订阅登录为默认对外分发，则视为阻断。

**落地动作**：D05 #7、D03 #5。

## 5. extensions/copilot：@github/copilot、@vscode/copilot-api、@github/blackbird-external-ingest-utils

**出处**（已真实打开主工作区 `extensions/copilot/node_modules/<pkg>/` 下文件）：

| 包 | license 字段 | 实际许可文件关键条款（原文） |
|---|---|---|
| `@github/copilot`（0.67.x 依赖） | `SEE LICENSE IN LICENSE.md` | "GitHub Copilot CLI License"：§1 授予安装运行权 + "the right to reproduce and redistribute **unmodified** copies of the Software **as part of an application or service**"；§2 条件：仅未修改形态、必须"provides material functionality beyond the Software itself"、不得 standalone 分发、保留 License 与版权/商标/署名 notices；§3 不授予修改权/去标权；商标仅限"as necessary to identify the Software" |
| `@vscode/copilot-api`（0.5.2） | `SEE LICENSE` | GitHub npm Module Terms：§1 "You may install and use any number of copies of the software **only with the Visual Studio Code or Code-OSS and successor Microsoft products and services** for use with GitHub Copilot. **The use with Code-OSS is allowed for development purposes only.** No other use is permitted."；§3.f 禁止 "provide the software as a stand-alone offering or combined with any of your applications **for others to use**, or transfer the software or this agreement to any third party, except in combining the software with GitHub applications" |
| `@github/blackbird-external-ingest-utils` | `MIT` | 标准 MIT，无附加限制 |

另有 `@vscode/copilot-api/COPILOT_CHAT_EXTENSION_LICENSE.md`（GitHub 扩展许可：仅限 "GitHub approved software" 使用）。

**裁定**：
1. **`@vscode/copilot-api` 是对外分发的硬阻断**：它把 Code-OSS 用途限定为 **development purposes only**，且明文禁止与"your applications"合并给他人使用。我们的分发物（非微软产品、给他人的 app）两个条件都踩。
2. `@github/copilot`（Copilot CLI 二进制 SDK）：允许**未修改**再分发且必须嵌入"提供实质额外功能"的 app——字面上"内嵌 VS Code fork"可满足，但须保留其专有 notices、不得修改；商标仅可用于标识该软件。风险中：其运行依赖 Copilot 服务条款（用户自己的 Copilot 订阅）。
3. `extensions/copilot`（copilot-chat，`license: "SEE LICENSE IN LICENSE.txt"`）本体在仓库内是 MIT（`extensions/copilot/LICENSE.txt`，已打开：MIT, Microsoft Corporation），但其运行时 npm 依赖即上述受限包。
4. GitHub Copilot 商标：产品名/宣传不得使用；仅可在"支持 GitHub Copilot"的事实描述中提及。

**结论**：**含 extensions/copilot（及其依赖闭包）的构建产物一律不得对外分发**（对应 G13/R1）。这正是 D08 的存在理由：D08 #10 须把 copilot 扩展与受限 SDK 从出厂产物剥离/隔离（开发自用构建不受影响——"development purposes only" 恰好覆盖我们自己开发调试）。

**是否阻断**：**是**（在 D08 完成剥离前，产物仅限内部开发使用）。

**落地动作**：D08 #10（剥离 + 隔离默认 chat agent `product.json.defaultChatAgent` 与遥测出口）；D09 #11（打包流水线校验产物不含 `@vscode/copilot-api` / `@github/copilot`，列入发布 checklist 门）。

## 6. GitHub MCP server（resolveGitHubMcpServerConfiguration 注入的内置 server）

**出处**（已真实打开）：
- `src/vs/platform/agentHost/node/shared/githubMcpServer.ts`（MIT 文件头）：`createGitHubMcpServerConfiguration` 生成 `{ type: REMOTE, url, headers }`，不带任何本地二进制；`resolveGitHubMcpServerConfiguration(copilotApiService, token)` **只在有 GitHub token 时**才解析配置（`if (!token) return undefined;`，`codexAgent.ts:1574-1578` 调用）。
- `src/vs/platform/agentHost/common/githubEndpoints.ts`：URL 由用户 Copilot API endpoint 派生，默认 `https://api.githubcopilot.com` + path `/mcp`（`gitHubMcpServerUrl`）。

**条款定性**：这不是再分发的软件，而是对 GitHub 远程服务（GitHub MCP Server，托管在 api.githubcopilot.com/mcp）的**运行时调用**。适用条款是 GitHub 站点条款：GitHub Terms of Service + GitHub Copilot Terms（用户与 GitHub 之间）+ GitHub API 使用条款（rate limit、禁止滥用）。我们的义务是：不做规避（headers 只声明 tools/features，均为服务端公开能力）、不代用户承诺、身份为用户自己的 OAuth token。

**裁定**：**不阻断**。随用户 GitHub 账号（有则用、无则该 server 不注入——G7 已确认无 token 即无此能力）调用远程服务，属于终端用户与 GitHub 之间的既存关系。工程侧需保证：a) 不缓存/转售他人 token；b) UI 不暗示该 server 与 GitHub 有从属关系；c) 首启不强制 GitHub 登录（G6/D04 #6 配套）。

**落地动作**：D08 #10（确认剥离 Copilot 后该路径默认关闭）、D04 #6（解 GitHub 强制耦合时保留"用户主动添加 GitHub token 才启用"语义）。

## 7. builtInExtensions（ms-vscode.js-debug 等）

**出处**（已真实打开 `product.json` `builtInExtensions`，3 项）：

| 扩展 | 版本 | sha256（前 16） | repo |
|---|---|---|---|
| ms-vscode.js-debug-companion | 1.1.3 | 7380a890… | github.com/microsoft/vscode-js-debug-companion |
| ms-vscode.js-debug | 1.117.0 | 854eeb8a… | github.com/microsoft/vscode-js-debug |
| ms-vscode.vscode-js-profile-table | 1.0.11 | a962a1e6… | github.com/microsoft/vscode-js-profile-visualizer |

三个上游仓库均为 MIT（微软开源），`metadata.publisherId.publisherName = ms-vscode` 只是发布通道标识。VSIX 在构建期从上游发布产物拉取并以 sha256 固定。

**义务清单**：MIT 义务（许可证文本随 VSIX 内携带）；保留版本与 sha256 pin（供应链完整性 + 可追溯）；分发物 notices 列出三者的名称/版本/许可/来源。

**裁定**：**不阻断**。MIT 允许再分发这些 VSIX；publisher 元数据不构成额外义务。注意：不要把"内置了微软发布的 VSIX"表述成与微软的从属/认可关系。

**落地动作**：D09 #11（打包清单固定三者 + 校验 sha256；THIRD-PARTY-NOTICES 收录）；D14 #16（上游同步时随 product.json 更新）。

## 8. Electron / Node / Chromium（cglicenses.json / cgmanifest.json 覆盖度）

**出处**（已真实打开 `cgmanifest.json`，14 个 registration）：
- Chromium（`chromium.googlesource.com/chromium/src`）、Node（github.com/nodejs/node）、Electron（github.com/electron/electron）、Inno Setup（jrsoftware/issrc）、spdlog、vscode-codicons、ripgrep（BurntSushi/ripgrep）、mdn-data、@mdn/browser-compat-data、@iktakahiro/markdown-it-katex、cacheable-request 等 npm 项，以及两项特殊项：
  - **ffmpeg**（chromium third_party/ffmpeg，`"license": "LGPL-2.1+"`，`isOnlyProductionDependency: true`）；
  - **H.264/AVC Video Standard**（other 类型，licenseDetail 原文："This product is licensed under the AVC patent portfolio license for the personal and non-commercial use of a consumer to (i) encode video… and/or (ii) decode AVC video… **No license is granted or shall be implied for any other use.** Additional information may be obtained from MPEG LA LLC."）
- `cglicenses.json`（JSONC，78 条）：对 cgmanifest 未覆盖的 npm 包补许可声明（如 @github/copilot 全平台二进制、@anthropic-ai/claude-agent-sdk、@microsoft/dev-tunnels-*、onnxruntime-node、jschardet 等）。

**覆盖度评估**：Electron/Node/Chromium 主链路 + 常见 npm 特例已覆盖；**缺口**是这些清单按微软官方产品维护，与我们的 node_modules 实际集合存在偏移（我们额外引入/裁剪的依赖需在 D19 SBOM 中对账）。Chromium/Node/Electron 主许可均为宽松（BSD-3/MIT），分发包附上游 ELECTRON_LICENSE / LICENSES.chromium.html（Electron 发行包自带）即可。

**ffmpeg LGPL-2.1+ 与 H.264**：
1. ffmpeg 以 LGPL 形态随 Chromium 链接进 Electron。Electron 官方分发包已在 `LICENSES.chromium.html` 声明 LGPL 组件并按 LGPL §4 的"allow reverse engineering for modification"等义务处理；直接再分发官方 Electron 预编译产物时，**保留其原带 notices 文件**即维持上游已建立的状态（VSCodium 同做法）。若未来自行编译 Electron/换编解码配置，则须重做 LGPL 合规（对应 checklist 条目）。
2. H.264/AVC 专利声明（MPEG LA）：AVC 专利池许可仅覆盖"个人非商业消费用途"；**商业分发内嵌 H.264 解码能力的软件存在专利许可问题**（微软官方构建有专利安排，fork 没有）。缓解选项：a) 接受现状但法务复核（VSCodium 同样照发官方 Electron，至今无公开执法——不是法律依据，只是风险参考）；b) 使用 ffmpeg 无专有编解码器构建的 Electron（社区构建）；c) 声明产品不含视频播放场景。**列为法务复核项**（§13）。

**裁定**：**不阻断**（沿用官方 Electron 预编译产物 + 保留其 notices），H.264 子项需法务确认。

**落地动作**：D09 #11（打包保留 LICENSES.chromium.html / LICENSE / THIRD-PARTY-NOTICES 于产物内；SBOM 引用 cgmanifest+cglicenses 并补差集）；D14 #16（升级 Electron 版本时刷新清单）。

## 9. 字体与图标

**codicon**（已真实打开）：
- 产物内文件：`src/vs/base/browser/ui/codicons/codicon/codicon.ttf`（随 `codicon.css` 内嵌加载）。
- 包：`node_modules/@vscode/codicons`，`package.json license: "CC-BY-4.0"`，目录含 `LICENSE`（CC-BY-4.0 全文）+ `LICENSE-CODE`（MIT，代码）；`ThirdPartyNotices.txt:2698` 亦记 "vscode-codicons 0.0.46-0 - MIT and Creative Commons Attribution 4.0"。
- **义务**：CC-BY-4.0 要求署名（attribution）——分发物（含 about/第三方声明文件）需标注 codicon 及其作者/链接；CC-BY 不限制商用、允许再分发与修改（修改须注明）。MIT 侧覆盖代码。
- **裁定**：**不阻断**，D06 若自绘图标替换 codicon，则义务消失；若沿用，须在 notices 中署名。

**seti 图标主题字体**：`extensions/theme-seti/icons/seti.woff`，上游 jesseweed/seti-ui（`ThirdPartyNotices.txt:2257 seti-ui 0.1.0`）。seti-ui 仓库许可历史上为非商业/定制条款（Unlicensed by default）——**需法务复核**：随产品分发该 woff 字体的授权依据；若不确定，D06/D09 可将 seti 主题降级为不内置或替换图标集（参考 VSCodium 直接移除了 seti 的非 MIT 图标）。
**产品图标（app icon）**：微软 VS Code 图标不可用（§1），D06 自绘。`extensions/copilot/assets/copilot.woff`（Copilot 字体图标）随 copilot 扩展一起受 §5 约束，D08 剥离后不进入产物。
**KaTeX 字体**（markdown-language-features 内嵌 ttf/woff）：KaTeX 为 MIT（字体亦随 MIT 发布），无附加义务。

**落地动作**：D06 #8（图标方案 + codicon 去留）、D09 #11（notices 署名 codicon；seti 决策落地）。

## 10. Marketplace 与 Open VSX

**MS Marketplace**（取证：Visual Studio Marketplace Terms of Use，官方条款）：
> "Marketplace Offerings are intended for use only with Visual Studio Products and Services and you may only install and use Marketplace Offerings with Visual Studio Products and Services."

**裁定**：第三方构建（VSCodium 及同类）不被覆盖，**产品不得配置 `extensionsGallery` 指向 MS Marketplace**。当前 `product.json` 本就无 `extensionsGallery`（G9）——保持"未配置"即合规基线；D15 接市场时**只允许 Open VSX 或自建/私有 registry**。VSCodium 的公开实践即默认 Open VSX。

**Open VSX**（open-vsx.org，Eclipse 基金会运营；registry 代码 EPL-2.0）：
- 消费侧义务：逐扩展遵守其声明许可（registry 不附加统一条款）；扩展内容许可由发布者负责。
- 发布侧义务（若我们向 Open VSX 发布自有扩展，D15/#17 相关）：签署 Open VSX Publisher Agreement（署名、非侵权承诺）、扩展需含 OSI 许可或明示条款。
- 运营风险：可用性/审核由 Eclipse 基金会承担，无 MS 依赖；可自建私有 registry（grok-code-product/docs/enterprise.md 已给 product.json 私有 registry 配置样例，可沿用）。

**是否阻断**：指向 MS Marketplace 则**阻断**；用 Open VSX **不阻断**。

**落地动作**：D15 #17（Open VSX 接入/私有 registry；不触碰 MS Marketplace）；D07 #9（Agents 窗口允许扩展列表随 gallery 方案走）。

## 11. 其他第三方依赖中非 MIT/Apache/BSD 的抽样清单

**扫描方法**：遍历主工作区 `node_modules/**/package.json`（顶层与 scoped，共 **1088** 个包），读 `license` 字段聚合；可疑项逐一打开 LICENSE 文件核对，并对照根 `package.json` 的 dependencies/devDependencies 判断是否进入分发产物。

**聚合**：MIT 888、ISC 63、Apache-2.0 48、BSD-3-Clause 30、BSD-2-Clause 18、BlueOak-1.0.0 7、CC-BY-4.0 2、Python-2.0 1、LGPL-2.1+ 1、WTFPL 1、CC0/Unlicense/dual 若干、`SEE LICENSE*` 3、对象形态/未声明 11（多数为 MIT 包的旧式 license 字段，如 ssh2=MIT、cpu-features=MIT，见下）。

**逐项裁定**（非 MIT/ISC/Apache/BSD 的全部可疑项）：

| 包 | license | 是否运行时依赖 | 进入分发产物？ | 裁定 |
|---|---|---|---|---|
| `jschardet` 3.1.4 | LGPL-2.1+（LICENSE 已核实为 LGPL 全文） | 是（dependencies，编码探测） | **是** | 唯一弱 copyleft：按 LGPL 以独立模块分发、附许可证全文、注明未修改（上游 cglicenses.json 已有 prependLicenseText 处理；跟随即可）。**不阻断** |
| `jszip` 3.10.1 | `MIT OR GPL-3.0-or-later` | 间接 | 部分（按用途） | 双许可，选 MIT 分支即无 copyleft 义务。**不阻断** |
| `@vscode/codicons` | CC-BY-4.0 + MIT(code) | 是 | **是**（codicon.ttf） | 见 §9，署名即可 |
| `caniuse-lite` | CC-BY-4.0（数据） | 构建链（browserslist） | **否**（dev 侧数据） | 构建期使用，不分发数据本身；如随源码分发需署名 |
| `argparse` | Python-2.0（PSF 风格，宽松） | dev | 否 | 宽松，无义务 |
| `queue` | WTFPL | dev/间接 | 否 | 公有领域风格，无义务 |
| `type-fest` | MIT OR CC0-1.0 | types only | 否 | 无义务 |
| `spdx-exceptions` / `spdx-license-ids` | CC-BY-3.0 / CC0 | dev（license 工具） | 否 | 构建期，无分发义务 |
| `@anthropic-ai/claude-agent-sdk`(-darwin-arm64) | `SEE LICENSE IN README.md`（Anthropic SDK，MIT 系） | **devDependencies**（根 package.json） | **否** | 开发/构建 copilot 扩展用；且随 §5 剥离后与产物无关 |
| `@vscode/copilot-api` | SEE LICENSE（GitHub 专有条款） | 是（copilot 扩展闭包） | **禁止**（见 §5） | **阻断项**，D08 剥离 |
| `@github/copilot`（+平台二进制） | GitHub Copilot CLI License | 是（copilot 扩展闭包） | **禁止/受限**（见 §5） | **阻断项**，D08 剥离 |
| `ssh2` 1.17 | license 字段为对象，LICENSE 实为 MIT（Brian White） | 是（remote 通道） | 是 | MIT，无义务 |
| `cpu-features` | 对象字段 → MIT（已核） | 可选 native | 部分 | MIT，无义务 |
| `chownr/tar/minipass/sax/path-scurry/jackspeak/package-json-from-dist` | BlueOak-1.0.0 | 混合 | 部分（tar/chownr 随远程文件系统） | BlueOak 为 ISC 后继的现代宽松许可（GPL 兼容、无 copyleft），义务=保留 notice。**不阻断** |
| `expand-template` | MIT OR WTFPL | dev | 否 | 无义务 |
| delayed-stream/gulp-buffer/map-stream/progress（UNDECLARED） | 无 license 字段（老包，实际 MIT 系） | dev（gulp 链） | 否 | 构建期；分发物不含 |
| `innosetup`（npm wrapper） | 对象字段（Inno Setup 自有宽松许可） | dev（Windows 打包） | 工具链 | 不进入产物；安装器本身随 D09 打包时注意 Inno Setup 许可（允许使用，禁止分发改名版安装器） |

**结论**：运行时唯一弱 copyleft = `jschardet`（LGPL-2.1+，独立模块 + 许可证文本 + 未修改声明即可）；其余非 MIT/Apache/BSD 项或为 dev-only、或为宽松许可（CC-BY/BlueOak/PSF/WTFPL）。**无强 copyleft 进入分发产物。不阻断。**

**落地动作**：D09 #11（把本清单与 D19 SBOM 交叉核对后生成为产物内 THIRD-PARTY-NOTICES；上游 `ThirdPartyNotices.txt` 继续保留并叠加我们的差集）。

## 12. 联系要点草稿（不实际发送；需单独授权）

**给 OpenAI（Codex 集成合规）**：
- 目的：将自有桌面 app 的 `clientInfo.name`（拟 `<ourname>_desktop`）加入 Compliance Logs Platform 的 known clients；确认非官方客户端允许的认证形态（API Key BYOK vs ChatGPT 订阅登录）。
- 事实要点：产品基于 Apache-2.0 的 codex app-server 二进制构建；不修改 codex；不转售服务；用户自带凭据；app 明示非 OpenAI 官方。
- 询问：a) known clients 登记流程；b) 订阅登录在第三方分发客户端中的可用性；c) 需要的商标使用边界（nominative use 措辞）。

**给 GitHub（如保留任何 Copilot 相关能力）**：
- 目的：确认 fork 产物中 Copilot 扩展/SDK 的分发边界（当前裁定为全部剥离，仅当法务希望保留时才需要）。

## 13. 需法务复核的条目（对应验收 7）

1. §2 商标合理使用边界：产品名/官网使用 "Codex"/"OpenAI" 的描述性方式。
2. §4 ChatGPT 订阅用于第三方分发客户端的可用性（影响 D03/D05 默认；建议以书面问询 OpenAI 定案）。
3. §5 `@vscode/copilot-api` dev-only 与 no-redistribution 条款的最终定性（当前按硬阻断处理，从严无坏处）。
4. §8.4 H.264/AVC 专利池声明对商业分发的影响（含是否选用无专有编解码的 Electron 构建）。
5. §9.2 seti 图标字体（seti-ui 非标准许可）是否可随产物分发。
6. 我方修改层的开源许可选择（沿用 MIT vs Apache-2.0，grok-build 先例）与 NOTICE 组织方式。

## 14. 先验资产比对（对应验收 9）

| 资产 | 内容 | 比对结论 |
|---|---|---|
| `grok-build/THIRD-PARTY-NOTICES`（762KB，gh api 拉取） | Rust crate 逐包条目：Source/License/版权行/Part II 许可证全文；对 OR 表达式声明"按 MIT 满足"；MPL-2.0 单列弱 copyleft 说明 | **格式与做法可沿用；内容因路线不同而失效**——它覆盖 grok-build 自身 Rust workspace 的 crate，我们的 Rust 依赖图是 @openai/codex 的（§2 已给出等价清单），两者交集有限。MPL-2.0 的"文件级 copyleft、不传染整体"表述模板可直接复用 |
| `grok-build/AUDIT.md` | grok-build 代码工程质量审计（架构/工具链/测试），非法律审计 | **因路线不同而失效**（对象是 grok-build 代码库）；仅"发布工程成熟度（TPN 完整、SECURITY/CONTRIBUTING 齐全）"作为流程基准可沿用 |
| `grok-build/LICENSE` | Apache-2.0，Copyright 2023-2026 SpaceXAI（对 fork 整体选择 Apache-2.0） | **可沿用为先例**：证明 MIT 上游 fork 可整体以 Apache-2.0 再发布（MIT→Apache-2.0 兼容）；供 §13.6 决策参考 |
| `grok-code-product/docs/enterprise.md` | Open VSX 默认市场 + 私有 registry product.json 配置、扩展允许/禁用策略、权限锁、更新控制、遥测默认关、MDM/SCCM 部署、air-gapped 安装 | **大部分可沿用**（同为 VS Code fork 的企业分发考量）；需补充：a) 品牌字段改为我们自己的（其基于旧上游 commit 138f619c）；b) Open VSX 条款细节（本文 §10）；c) 与 D04/D05 的认证策略对齐 |
| `grok-code-product/scripts/generate-sbom.sh` | 手写 3 组件 CycloneDX 1.5（vscode MIT / grok-agent Apache-2.0 / node_modules 指针）+ 简版 THIRD-PARTY-LICENSES.txt | **结构可沿用，内容需补充**——手写 SBOM 粒度过粗（"See node_modules/*/package.json" 不满足 D09 验收 13 的完整清单要求）。裁定：不移植该脚本本体，改为 D19 用仓库既有 `cgmanifest.json`/`cglicenses.json` 为基线 + node_modules/cargo 图差集合并生成（对应验收 10；与 D09 验收 13 一致：SBOM 覆盖 npm 运行时依赖、codex crate 图、builtInExtensions、Electron 链路四部分） |

## 15. 发布前 Checklist 摘要

见同目录 `PRE-RELEASE-CHECKLIST.md`（D06/D08/D09 的 PR 描述必须引用该文件链接）。

## 附：本文引用的关键文件路径

- 本仓库：`LICENSE.txt`、`product.json`、`cgmanifest.json`、`cglicenses.json`、`ThirdPartyNotices.txt`、`src/vs/platform/agentHost/node/codex/codexAgent.ts`、`src/vs/platform/agentHost/node/shared/githubMcpServer.ts`、`src/vs/platform/agentHost/common/githubEndpoints.ts`、`extensions/copilot/LICENSE.txt`、`extensions/copilot/package.json`、`extensions/copilot/node_modules/@github/copilot/LICENSE.md`、`extensions/copilot/node_modules/@vscode/copilot-api/LICENSE`、`src/vs/base/browser/ui/codicons/codicon/codicon.ttf`、`node_modules/@vscode/codicons/`
- codex 仓库（只读）：`LICENSE`、`NOTICE`、`codex-rs/app-server/README.md`、`codex-rs/deny.toml`
- 先验资产（gh api）：`grok-build/{THIRD-PARTY-NOTICES,AUDIT.md,LICENSE}`、`grok-code-product/{docs/enterprise.md,scripts/generate-sbom.sh,VERSION,UPSTREAM_COMMIT}`
- 公开条款：Visual Studio Marketplace Terms of Use、OpenAI Terms of Use（2026-01-01）、OpenAI Usage Policies、OpenAI Help Center《Using Codex with your ChatGPT plan》、openai/codex discussion #8338、cline.bot OAuth 公告、VSCodium 公开文档/FAQ
