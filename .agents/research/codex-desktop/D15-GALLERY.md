# D15 决策记录 — 扩展市场与生态可用性（Issue #17）

> 实施分支：`codex-desktop/d15-extension-gallery`（基底：d09-packaging-pipeline tip，
> 避免与在途 D09 的 product/product.json 改动冲突）。修复 G9（出厂无市场）。
> 调研依据：`00-FINDINGS.md`、`LICENSE-CLEARANCE.md`（D10）§10、VSCodium product.json 先例。

## D15-01 Gallery = Open VSX（唯一定点）

- **裁定**：`extensionsGallery` 指向 Open VSX（open-vsx.org，EPL-2.0 注册表，
  VSCodium 先例）。MS Marketplace 禁止（D10 §10 ToS：Marketplace Offerings 仅限官方
  Visual Studio 产品）。不自建 registry（非目标）。
- **落地**：D06 mixin 覆盖层 `product/product.json` 注入，上游 product.json 保持
  0 diff（`check-product-json-pristine.sh` 不变）：

  ```json
  "extensionsGallery": {
      "serviceUrl": "https://open-vsx.org/vscode/gallery",
      "itemUrl": "https://open-vsx.org/vscode/item",
      "resourceUrlTemplate": "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}"
  }
  ```

- **字段核实**（对照 VSCodium 与线上服务实测，2026-09-20）：
  - `serviceUrl` + `itemUrl`：VSCodium 同款最小集；`extensionquery`、
    `vscode/{pub}/{name}/latest`、统计端点均由 `serviceUrl` 派生
    （`extensionGalleryManifestService.ts`）。实测 POST extensionquery → 200。
  - `resourceUrlTemplate`：占位符 `{path}` 在运行时固定替换为 `extension`
    （`extensionResourceLoader.ts`），实测
    `…/unpkg/redhat/vscode-yaml/latest/extension/package.json` → 200。
    注意裸 `{publisher}/{name}/{version}/{path}`（不带 `extension/` 前缀）是 404——
    模板按规格原样使用即可，运行时替换会补齐。
  - 未设置 `controlUrl`（恶意扩展下架通道，Open VSX 无对应服务）与
    `nlsBaseUrl`（语言包 CDN，Open VSX 无对应服务）——两者在上游均为可选，
    缺省时对应功能静默关闭。
  - 实际文件下载经 gallery 响应中的绝对 URL 302 到 Eclipse CDN
    `openvsx.eclipsecontent.org`（实测）——出口审计口径见 D15-02。

## D15-02 出口审计（AC2/AC3）

- `audit-network-egress.sh` 是 denylist 制：`open-vsx.org` /
  `openvsx.eclipsecontent.org` 均不在 denylist，也**不得**加入
  （单测断言守护，见下）。
- 审计 layer 1 新增 D15 断言（CI 门禁，`.github/workflows/codex-desktop-baseline.yml`
  既有步骤自动覆盖）：
  1. 合并后（出厂）配置中禁止出现 MS Marketplace 域名：
     `marketplace.visualstudio.com`、`vsassets.io`、`gallerycdn`、
     `vscode.blob.core.windows.net`；
  2. `extensionsGallery` 的每个字符串字段必须是 `https://open-vsx.org/` 前缀。
- 实测（GUI+CLI 全量日志目录递归 grep）：无任何 MS Marketplace / 遥测域名请求（AC3）。
- github.com 域名（builtInExtensions 拉取）不在 denylist——D08 审计设计即如此
  （用户可见链接不属隐式出口；下载由打包流水线显式发起，见 D15-04）。

## D15-03 sessionsWindowAllowedExtensions 维持 `[]`（AC5）

- 维持 D07 裁定：Agents 窗口不允许任何第三方扩展激活。
- 断言已存在且复核通过：
  `src/vs/code/test/node/agentsWindowStartup.test.ts` —
  "sessionsWindowAllowedExtensions is an explicitly empty allow-list"。
  本分支未改动该行为。

## D15-04 builtInExtensions（AC7）

- **裁定**：保留现状——`ms-vscode.js-debug` 等 3 个内置扩展带 sha256 +
  publisher 元数据，从 `github.com/microsoft/*` 拉取（MIT 允许再分发）。
- 自托管镜像记录为**可选后续项**（不阻断发布；github.com 拉取失败时打包流水线
  已有多重重试 + GITHUB_TOKEN 提额，D09）。
- 内置扩展清单：`extensions/` 下语言/主题/基础功能全部保留；依赖外部服务的扩展
  （MS 账户相关）已在 D08 默认禁用，本 issue 不重复处置（交叉引用 D08-DECISIONS.md）。

## D15-05 Workspace trust（AC6）

- 维持上游默认（on），不做产品级改动。
- `--disable-workspace-trust` CLI 开关存在且可用（`argv.ts` 保留），自动化场景可用。

## D15-06 VSIX 本地安装兜底

- Gallery 移除（回滚方式：删除覆盖层 `extensionsGallery` 键）后回到"无市场"状态，
  仍可通过 `--install-extension <path-to.vsix>` 或 GUI "Install from VSIX" 安装。
  该路径不依赖 gallery 配置。

## 实测证据（AC1/AC4）

见 `evidence/d15-gui-extensions-view.txt`、`evidence/d15-openvsx-gallery-trace-cli.log`、
`evidence/d15-installed-extensions.json`。摘要：

- dev 产物（Electron 43.6.0，"Colin Code Dev"）Extensions 视图搜索 "tombi" →
  Open VSX 实时结果列表（Tombi 1.5.5 等，含 Install 按钮）。
- 经产品自身扩展管理管线安装 `tombi-toml.tombi`（MIT）成功；HTTP 全程仅
  open-vsx.org（extensionquery POST 200 → manifest 200 → VSIX 200, 8.9 MB）。
- 重启后 `@installed` 仍列出 Tombi 1.5.5（状态持久）。
- 环境说明：测试机的 Clash 系统代理对 Node/BoringSSL TLS 有干扰（环境问题，
  非产品缺陷）；经 `http.proxy` 走代理 CONNECT 后全部成功。

## 附带修复（前置阻塞，非 D15 范围扩大）

- `welcomeOnboarding/browser/onboardingVariationA.ts`：模块级
  `assertDefined(product.defaultChatAgent)` 在 D08 删除该键后导致 workbench
  启动即抛、窗口白屏（任何 GUI 运行都复现）。修复为惰性断言
  （`getDefaultChat()`）+ `show()` 在无 defaultChatAgent 时直接跳过。
  建议 D08 owner 知悉：该断言是其删除动作的遗漏消费者。

## D10 checklist 勾销支持（AC8）

- `LICENSE-CLEARANCE.md` §10「Marketplace / Open VSX」条目由本 issue 落地：
  出厂 gallery = Open VSX（D15-01），无 MS Marketplace 指向（D15-02 门禁 + 实测），
  owner 可据此勾销。

## AC 映射

| AC | 落点 |
|----|------|
| AC1 搜索/安装/启用真实扩展 | evidence/d15-*（GUI 搜索 + 管线安装 + 视图列出） |
| AC2 gallery 域名合规 | D15-02；audit layer 1 断言；denylist 未新增 |
| AC3 无 MS Marketplace 请求 | D15-02 门禁 + 日志递归 grep 零命中 |
| AC4 重启持久 | evidence/d15-gui-extensions-view.txt §3 |
| AC5 sessions 白名单 | D15-03（D07 断言复核通过） |
| AC6 workspace trust | D15-05 |
| AC7 builtInExtensions | D15-04 |
| AC8 D10 checklist 勾销 | 上文「D10 checklist 勾销支持」 |
