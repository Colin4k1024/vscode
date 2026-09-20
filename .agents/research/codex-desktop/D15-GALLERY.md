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
      "publisherUrl": "https://open-vsx.org/namespace",
      "resourceUrlTemplate": "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}"
  }
  ```

  （`publisherUrl` 由补充 PR 增补，见附录 B.7。）

- **字段核实**（对照 VSCodium 与线上服务实测，2026-09-20）：
  - `serviceUrl` + `itemUrl`：VSCodium 同款最小集；`extensionquery`、
    `vscode/{pub}/{name}/latest`、统计端点均由 `serviceUrl` 派生
    （`extensionGalleryManifestService.ts`）。实测 POST extensionquery → 200。
  - `resourceUrlTemplate`：占位符 `{path}` 在运行时固定替换为 `extension`
    （`extensionResourceLoader.ts`），实测
    `…/unpkg/redhat/vscode-yaml/latest/extension/package.json` → 200。
    注意裸 `{publisher}/{name}/{version}/{path}`（不带 `extension/` 前缀）是 404——
    模板按规格原样使用即可，运行时替换会补齐。
  - 未设置 `controlUrl`（恶意扩展下架通道；Open VSX 无内建 control 服务，EclipseFdn 的 extension-control（raw.githubusercontent.com）可作为后续可选接入——接入时需同步放宽 egress 门禁的 open-vsx 前缀检查）与
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
  publisher 元数据（MIT 允许再分发）。拉取来源表述以附录 B.5 的更正为准：
  gallery 已配置时构建管线实际从 Open VSX 拉取（`fromMarketplace`），两来源 bits
  逐字节一致（sha256 实测）。
- 自托管镜像记录为**可选后续项**（不阻断发布；github.com 拉取失败时打包流水线
  已有多重重试 + GITHUB_TOKEN 提额，D09）。
- 内置扩展清单：`extensions/` 下语言/主题/基础功能全部保留；依赖外部服务的扩展
  （MS 账户相关）已在 D08 默认禁用，本 issue 不重复处置（交叉引用 D08-DECISIONS.md）。

## D15-05 Workspace trust（AC6）

- 维持上游默认（on），不做产品级改动。
- `--disable-workspace-trust` CLI 开关存在且可用（`argv.ts` 保留），自动化场景可用。

## D15-06 VSIX 本地安装兜底（回滚权威口径：本节为准）

- Gallery 移除（回滚方式：删除覆盖层 `extensionsGallery` 键——自补充 PR 起还须**同删/同改**：① `scripts/audit-network-egress.sh` 与 ② `scripts/verify-beta-gates.sh` 中的 gallery 存在性断言；③ `src/vs/code/test/node/extensionGallery.test.ts` **整个文件**（5 个 test 全部为 D15 gallery 专属：overlay pin、merged pin、G9 pin、denylist pin、overlay-vs-base pin——只删前两个仍剩 G9 pin 红，且文件命中 `test/unit/node/index.js` 的全量 glob，只删 CI 行不删文件会让全量 `npm run test-node` 红）；④ `.github/workflows/codex-desktop-baseline.yml` 中该文件的 `--run` 行；⑤ `PRE-RELEASE-CHECKLIST.md` E1/E3 的勾销回退为未勾选（勾销声明的门禁已不存在）；⑥ `LICENSE-CLEARANCE.md` §10 的"D15 起缺失=硬失败"裁定回退为"未配置即合规基线"。缺任一即撞上有意的显式回滚门或留下不一致的合规声明；执行 ③ 后本地还须重编译或删除 `out/vs/code/test/node/extensionGallery.test.js` 陈旧产物（CI 全新 transpile 不受影响）；回滚后同步清理的其余 D15 痕迹（非穷尽，以 `grep -rn D15 .agents .github scripts build src` 为准）：`01-ACCEPTANCE-CORE.md` D1 行、`UPSTREAM-SYNC.md` D15 行与计数、checklist G 段状态行、baseline workflow 步骤名注释、`build/hygiene.ts` 的豁免分支）后回到"无市场"状态，
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
  出厂 gallery = Open VSX（D15-01），无 MS Marketplace 指向（D15-02 门禁 + 实测）。
- `PRE-RELEASE-CHECKLIST.md` E1/E2/E3 已由补充 PR 勾销（含证据指针与 G 段状态记录）。

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
| AC8 D10 checklist 勾销 | 上文「D10 checklist 勾销支持」；`PRE-RELEASE-CHECKLIST.md` E1/E2/E3 已勾销（补充 PR） |

---

## 附录 B — 第二轮独立实测（complement PR，2026-09-20 晚）

> 由独立于首轮实现的会话完成：不同扩展（redhat.vscode-yaml，Open VSX 报 license: MIT）、
> 不同 profile、全程 `--log-net-log` 抓包。结论与首轮一致，并补强 AC4/AC5/AC6/AC7 的
> 运行时证据。首轮（tombi）与本轮（yaml）互为独立复现。

### B.1 搜索 / 安装 / 启用（AC1 复现 + 激活证据）

- Extensions 视图搜 `yaml` → Open VSX 结果实时返回（Red Hat YAML 7.6M 安装量置顶，
  截图 `evidence/d15-extensions-search-yaml.png`）。
- 列表项下拉 "Install Release Version" → shared process 日志：
  `Extension installed successfully: redhat.vscode-yaml`（1.24.0 稳定版；
  `extensions.json` 记录 `metadata.source: "gallery"`）。
- 打开 `test.yaml` → 状态栏语言模式 = **YAML**；exthost 日志
  `ExtensionService#_doActivateExtension redhat.vscode-yaml, activationEvent: 'onLanguage:yaml'`。
- 安装日志含 `Could not load vsce-sign module … Extension signature verification is not done`：
  OSS 构建无 `@vscode/vsce-sign`（MS 专有模块），签名验证不可用——与 VSCodium 同形态，
  如实登记；缓解 = Open VSX 发布侧审核 + namespace 所有权 + builtInExtensions sha256 pin。
- 日志工件：`evidence/d15-second-round-logs.txt` §1（安装序列原文）/ §2（激活记录）/
  §5（`extensions.json` 的 `metadata.source: "gallery"`）。

### B.2 重启持久（AC4，两轮重启）

同一 `--user-data-dir/--extensions-dir` 连续重启两次：
`@installed` 均列出 YAML；再次打开 `test.yaml` 在新会话 exthost 日志重新激活；
`extensions/redhat.vscode-yaml-1.24.0-universal/` 在盘持久
（截图 `evidence/d15-extensions-installed-after-restart.png`）。
后续在本 PR 基底（main 合并态）上再次复验：已装扩展在列、搜索实时返回（netlog4 抓包）。
日志工件：`evidence/d15-second-round-logs.txt` §3（第二会话 exthost 再激活记录）。

### B.3 Agents 窗口不激活未列入扩展（AC5 运行时证据）

同一 profile（已装 redhat.vscode-yaml）以 Agents 窗口（会话日志目录 `20260920T203313`）
打开 `test.yaml`：文件正常打开（编辑器打开不落 info 日志，此正向半句以截图为准），
但该窗口 exthost 日志**无** `redhat.vscode-yaml` 激活记录（对照：常规窗口同操作有，
日志可复现——见下）。
激活的仅有内置扩展（vscode.git、vscode.emmet 等）。
对照工件：`evidence/d15-second-round-logs.txt` §4（Agents 窗口会话激活全量列表 +
redhat 命中数 0；与 §2 常规窗口激活记录对照）。截图
`evidence/d15-agents-window-yaml-not-activated.png`（窗口形态佐证）。
静态断言：`agentsWindowStartup.test.ts` "sessionsWindowAllowedExtensions is an
explicitly empty allow-list"（首轮已挂）。

### B.4 Workspace trust 双向实测（AC6）

- 全新 profile 打开新文件夹 → **Restricted Mode** banner 出现
  （截图 `evidence/d15-workspace-trust-restricted-mode.png`）。
- 同形态加 `--disable-workspace-trust` → 无 Restricted Mode（自动化路径可用）。

### B.5 builtInExtensions 三项 sha256 对 Open VSX 逐一比对（AC7 补强 + 一处更正）

| 扩展 | 版本 | pin（root product.json） | Open VSX 实拉 sha256 | 结论 |
|---|---|---|---|---|
| ms-vscode.js-debug-companion | 1.1.3 | `7380a890…de93` | `7380a890…de93` | 一致 |
| ms-vscode.js-debug | 1.117.0 | `854eeb8a…c7fb8` | `854eeb8a…c7fb8` | 一致 |
| ms-vscode.vscode-js-profile-table | 1.0.11 | `a962a1e6…48ae9` | `a962a1e6…48ae9` | 一致 |

（`https://open-vsx.org/vscode/gallery/publishers/ms-vscode/vsextensions/{name}/{version}/vspackage`
实拉 + `shasum -a 256`，2026-09-20。注意 `{name}` 为**裸扩展名**（`js-debug-companion`，
不含 `ms-vscode.` 前缀；填全 id 会 404）。）

**更正 D15-04 的拉取来源表述**：`build/lib/builtInExtensions.ts` 的
`getExtensionDownloadStream` 在 gallery 已配置且扩展无 `vsix`/`platformSpecific`
字段时走 `fromMarketplace(serviceUrl, …)`（三项 js-debug 均满足），
即出厂形态（mixin 应用后）三项 js-debug 实际从 **Open VSX** 拉取并以 pin 校验
（dev 首启日志的 `[marketplace]` 标签由 serviceUrl 是否存在决定，间接佐证配置生效，实测通过；分支选择以代码为准）；
`fromGithub` 仅在 gallery 未配置时回退。结论（保留三项、无需自托管镜像）不变，
且上表证明两条来源的 bits 逐字节一致。

### B.6 守卫补强：gallery 存在性断言（G9 回归门）

首轮 `audit-network-egress.sh` 的 gallery 断言在 `extensionsGallery` **缺失**时静默通过
（`if (gallery)` 只检字段、不检存在）。本 PR 补 `else` 分支：合并配置无
`extensionsGallery` 即红——删除 mixin 中的 gallery 键必须连同该断言一起删（显式回滚），
防止 G9 静默回归。

### B.7 补充配置项：`publisherUrl`

`product/product.json` overlay 增补 `"publisherUrl": "https://open-vsx.org/namespace"`
（实测 `…/namespace/redhat` → 200），补齐扩展详情页的发布者外链
（`extensionGalleryManifestService.ts` 的 `PublisherViewUri`）。

### B.8 本轮 netlog 主机聚合（AC2/AC3 复测）

**裁定（B.8-R1）**：扩展 readme/图标等**内容渲染**引入的第三方主机（如 `img.shields.io`、`raw.githubusercontent.com`）属用户触发浏览的内容驱动出口，不在 D1 白名单约束内（已同步写入 `01-ACCEPTANCE-CORE.md` D1 行）。该收窄不改变 denylist 门禁的任何行为，仅消除"白名单文本 vs 实测出口"的表面冲突。

工件：`evidence/d15-netlog-hosts.txt`（四轮 `--log-net-log` 抓包的按主机计数全量）。

| 运行 | open-vsx.org | openvsx.eclipsecontent.org | MS Marketplace 主机 | 备注 |
|---|---|---|---|---|
| run1 搜索+安装（补充 PR 第一轮分支构建） | 201 | 101 | **0** | img.shields.io / raw.githubusercontent.com 均为 readme 内容渲染 |
| run2 重启 / run3 Agents 窗口 | 10 / 0 | 1 / 0 | **0** | 重启轮为扩展更新检查；Agents 窗口零 gallery 请求。run1/run2 亦各含 4 次 `main.vscode-cdn.net`（同 run4 注的 dev-only copilot 归因，工件脚注总述） |
| run4 main 合并态复验 | 49 | 17 | **0** | 含 4 次 `main.vscode-cdn.net/extensions/copilotChat.json`——dev 形态在仓 extensions/copilot 发出（D08 门禁其不进产物），非出厂行为 |
