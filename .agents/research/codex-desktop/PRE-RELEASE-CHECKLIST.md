# D10 发布前合规 Checklist（PRE-RELEASE-CHECKLIST）

> 配套文档：`LICENSE-CLEARANCE.md`（同目录）。**本文档不构成法律意见**；带 ⚖ 的条目需法务复核确认后才能勾选。
> 使用方式：D06（#8）/ D08（#10）/ D09（#11）的 PR 描述必须引用本文件，并逐条标注该 PR 覆盖/不覆盖的项。 Epic #1 的发布门 = 本清单全部"发布门"条目通过。

## A. 品牌与商标（D06 #8）

- [ ] A1【发布门】产品名不含 "VS Code"/"Visual Studio Code"/"Code"（避免混淆的近似名）；`product.json` 的 `nameShort/nameLong/applicationName` 全部替换
- [ ] A2【发布门】应用图标、安装横幅、DMG 背景全部为自有作品（不修改微软原图标）
- [ ] A3【发布门】`darwinBundleIdentifier`、`win32*AppId`、`dataFolderName`、`urlProtocol` 与微软默认值不同且已注册到我们名下
- [ ] A4 `clientInfo.name` 已从 `vscode_agent_host` 改为自有稳定标识，`version` 反映 app 版本（`codexAgent.ts` CLIENT_INFO + replay capture 更新）
- [ ] A5 ⚖ 产品页/README 的 "Codex / OpenAI / GitHub Copilot" 描述性使用措辞经法务确认（"powered by / built on"，非官方声明）
- [ ] A6 ⚖ 我方修改层的许可选择（沿用 MIT 或 Apache-2.0，grok-build 先例见 LICENSE-CLEARANCE §14）已定案并写入仓库根 LICENSE/NOTICE

## B. Copilot 与受限 SDK 剥离（D08 #10）

- [ ] B1【发布门】分发产物不含 `@vscode/copilot-api`（dev-only 条款，见 LICENSE-CLEARANCE §5）
- [ ] B2【发布门】分发产物不含 `extensions/copilot`（GitHub Copilot 扩展）与其依赖闭包（`@github/copilot`、平台二进制、`copilot.woff` 等）
- [ ] B3【发布门】`product.json.defaultChatAgent` 不再指向 `GitHub.copilot`；默认 chat agent 为 Codex 或空
- [ ] B4【发布门】遥测出口审计：`agentsTelemetryAppName`、`webviewContentExternalBaseUrlTemplate`、Aria/internalLargeStorage key 等第三方出口已关闭或指向自有端点
- [ ] B5 打包流水线含自动校验脚本：产物内 grep 上述受限包名/扩展 ID 为空（CI 门禁化）
- [ ] B6 ⚖ 若未来希望恢复任何 Copilot 能力：先过法务（GitHub 专有条款），见 LICENSE-CLEARANCE §12 草稿

## C. OpenAI 侧条款（D03 #5 / D05 #7 联动）

- [ ] C1 默认认证/计费路径 = API Key（BYOK）；ChatGPT 订阅登录标注"个人自用/实验"
- [ ] C2 ⚖ 企业分发前：已通过公开渠道向 OpenAI 登记 known client（clientInfo.name），并留存书面往来（联系要点草稿见 LICENSE-CLEARANCE §12）
- [ ] C3 用户界面明示"本产品为独立第三方产品，非 OpenAI/GitHub 官方出品"

## D. 分发物许可文件（D09 #11）

- [ ] D1 产物内含：本仓库 MIT LICENSE.txt（+ 我方许可选择结果，见 A6）
- [ ] D2 产物内含：codex 的 Apache-2.0 LICENSE 全文 + NOTICE 原文（含 Ratatui 段落）
- [ ] D3 产物内含：codex Rust crate 许可清单（以 LICENSE-CLEARANCE §2 的 cargo metadata 扫描为基线，打包时重跑生成）
- [ ] D4 产物内含：`THIRD-PARTY-NOTICES`（上游 `ThirdPartyNotices.txt` 为基线 + node_modules 差集：jschardet LGPL-2.1+ 全文与未修改声明、codicon CC-BY-4.0 署名、builtInExtensions 三项 MIT、BlueOak 项等）
- [ ] D5 产物内含：Electron 分发包原带 notices（`LICENSE`、`LICENSES.chromium.html`、Electron LICENSE），未删改
- [ ] D6 builtInExtensions 三项以 sha256 校验拉取，清单记录名称/版本/来源
- [ ] D7 ⚖ H.264/AVC 专利声明决策已定（沿用官方 Electron / 换无专有编解码构建 / 风险接受书面记录）
- [x] D8 seti 图标字体：**已裁定为 MIT（四源一致，LICENSE-CLEARANCE §9.2），随 notices 保留即可**（2026-09-19）
- [ ] D9 codicon 若沿用：notices 已署名（CC-BY-4.0）

## E. 市场与扩展（D15 #17）

- [x] E1【发布门】`product.json.extensionsGallery` 不指向 MS Marketplace（保持空或 Open VSX/私有 registry）— **2026-09-20 落地（D15 #17）**：mixin `product/product.json` 指向 Open VSX（`open-vsx.org`）；`scripts/audit-network-egress.sh` layer-1 断言（MS Marketplace 主机禁令 + gallery 字段 open-vsx.org 前缀 + gallery 必须存在）已挂 baseline CI。实测见 `D15-GALLERY.md`。
- [x] E2 接入 Open VSX 前：已读其 Terms/Publisher Agreement；自有扩展发布含 OSI 许可 — **2026-09-20（D15 #17）**：消费侧无统一条款（逐扩展许可自负，LICENSE-CLEARANCE §10）；发布侧义务（Publisher Agreement + OSI 许可）记录于 `D15-GALLERY.md`。当前**无自有扩展发布计划**，该义务在发布首个自有扩展时才触发。
- [x] E3 `sessionsWindowAllowedExtensions` 与所选 gallery 一致，不引用 MS 专有扩展 — **2026-09-20 裁定（D15 #17）**：白名单**显式为空**（`[]`），不引用任何扩展（MS 专有或其他），与 Open VSX 选择一致；单测断言防扩大（`agentsWindowStartup.test.ts` "sessionsWindowAllowedExtensions is an explicitly empty allow-list"）；Agents 窗口实测代码承载扩展不激活（`D15-GALLERY.md` 补充实测 §B.3）。未来若要放行代码承载扩展，须先改该单测并重新过审。

## F. SBOM 与审计（D19 / D09 验收 13 联动）

- [ ] F1 SBOM 生成方式定案：`cgmanifest.json` + `cglicenses.json` 为基线，叠加 ① npm 运行时依赖（package.json license 字段扫描）② codex crate 图（cargo metadata）③ builtInExtensions ④ Electron/Chromium 链路；输出 CycloneDX 1.5（不移植 grok-code-product 的手写 3 组件脚本，理由见 LICENSE-CLEARANCE §14）
- [ ] F2 SBOM 与 LICENSE-CLEARANCE §11 清单交叉核对一致（差异需逐条解释）
- [ ] F3 打包流水线每次出包自动重跑 cargo/npm 许可扫描，与基线 diff，新增非宽松许可即失败

## G. 发布门状态记录

| 日期 | 状态 | 说明 |
|---|---|---|
| 2026-09-19 | **未通过** | 初始裁定：G13 未解（A1-A3、B1-B4、E1 均未落地）；在此之前 D09 产物标记"仅内部使用" |
| 2026-09-20 | **未通过** | D15 #17 落地 E1/E2/E3（Open VSX 接入 + 空白名单裁定 + CI 守卫）；A1-A3、B1-B4 仍未全绿，发布门维持未通过 |
