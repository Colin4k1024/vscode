# D15 扩展市场与生态可用性 — 裁定与实测证据（Issue #17）

> **结论（一句话）**：ColinCode 出厂形态的扩展市场 = **Open VSX**（`open-vsx.org`，mixin overlay `product/product.json` 配置），Extensions 视图搜索/安装/启用/重启持久全链路实测通过；**不触碰 MS Marketplace**（CI 守卫断言）；Agents 窗口扩展白名单显式为空并 CI 钉死；builtInExtensions 三项 js-debug 保留且 sha256 pin 与 Open VSX 实拉文件一致。
>
> Issue：Colin4k1024/vscode#17（Part of #1）。基线：`origin/main` @ `867e09e1d0e`。裁定与实测日期：2026-09-20。实测机：macOS arm64（darwin 25.6.0），dev 形态（`scripts/code.sh` + mixin 应用后）。

---

## 1. Gallery 裁定：Open VSX（对应验收 1/2/3，checklist E1）

**裁定**：接入 Open VSX。备选评估：

| 方案 | 结论 | 理由 |
|---|---|---|
| MS Marketplace | **禁止** | ToS 限官方 Visual Studio 产品（LICENSE-CLEARANCE §10 引原文）；第三方构建接入即违约 |
| Open VSX | **采纳** | Eclipse 基金会运营；VSCodium 公开先例；消费侧无统一附加条款；registry 代码 EPL-2.0（我们只消费 API，不再分发 registry） |
| 自建 registry | 不采纳（现阶段） | issue 非目标"不自建 gallery 服务端"；Open VSX 已满足需求；`product.json` 私有 registry 样例留作企业部署选项（grok-code-product/docs/enterprise.md 已有样例可沿用） |
| 不提供 | 不采纳 | G9 即"出厂 app 装不了扩展"，违背 issue 目标 |

### 配置（`product/product.json` overlay；root `product.json` 保持 0-diff）

```json
"extensionsGallery": {
	"serviceUrl": "https://open-vsx.org/vscode/gallery",
	"itemUrl": "https://open-vsx.org/vscode/item",
	"publisherUrl": "https://open-vsx.org/namespace",
	"resourceUrlTemplate": "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}"
}
```

字段与本仓库代码形态核对（`src/vs/base/common/product.ts` `IProductConfiguration.extensionsGallery` + `src/vs/platform/extensionManagement/common/extensionGalleryManifestService.ts`，本 fork 的 gallery manifest 由代码按 product.json 字段**合成**，不再从服务端拉 manifest）：

| 字段 | 值 | 代码消费点 | 实测 |
|---|---|---|---|
| `serviceUrl` | `https://open-vsx.org/vscode/gallery` | 合成 `{serviceUrl}/extensionquery`（搜索/查询 POST）与 `{serviceUrl}/vscode/{publisher}/{name}/latest`（按名取最新版） | 两端点 curl 实测 200 |
| `itemUrl` | `https://open-vsx.org/vscode/item` | 扩展详情页外链（`?itemName={publisher}.{name}`） | 302 → 扩展页（人类链接） |
| `publisherUrl` | `https://open-vsx.org/namespace` | 发布者页外链（`{publisherUrl}/{publisher}`） | 200 |
| `resourceUrlTemplate` | `https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}` | `extensionResourceLoader` 拼扩展资源（图标/readme 等） | unpkg 端点实测 200 |
| `controlUrl` | **省略** | 扩展控制清单（恶意扩展 blocklist）。省略时 `getExtensionsControlManifest` 返回空（`extensionGalleryService.ts` 早退），**零额外出口** | 裁定为省略：避免引入 raw.githubusercontent.com（EclipseFdn publish-extensions）周期性拉取；未来需要时可指向自建镜像 |
| `extensionUrlTemplate` | **省略** | latest-version API 的 unpkg fallback；Open VSX 原生支持 latest 端点，无需 fallback | — |
| `nlsBaseUrl` | **省略** | 仅 web/webWorker 场景拼接 nls 消息；桌面 Electron 不消费 | — |

**回滚**（issue 要求）：从 `product/product.json` 删除 `extensionsGallery` 即回到"无市场"（VSIX 本地安装仍可用）；守卫脚本会随之报"gallery 未配置"，属预期（删除 overlay 键时须同步移除/调整守卫，见 §7）。

### 网络出口证据（验收 2/3）

三轮 `--log-net-log` 全程抓包（搜索 + 安装 + 重启 + Agents 窗口），按 URL host 聚合：

| 运行 | open-vsx.org | openvsx.eclipsecontent.org | marketplace.visualstudio.com / *.vsassets.io | vscode-cdn.net | 其他 |
|---|---|---|---|---|---|
| 搜索+安装（常规窗口） | 201 | 101 | **0** | 4（见下注） | img.shields.io 34、raw.githubusercontent.com 7、wpad 21 |
| 重启后（常规窗口） | 10（启动时扩展更新检查） | 1 | **0** | 4（同上） | wpad 12 |
| Agents 窗口 | 0 | 0 | **0** | 0 | wpad 6 |

- **验收 3 通过**：全程无任何对 `marketplace.visualstudio.com` / `*.vsassets.io` / `gallerycdn*` 的请求。
- `openvsx.eclipsecontent.org` 是 Open VSX 的文件 CDN（图标/readme/vsix/sigzip 落点，`open-vsx.org` 302 跳转目标），与 `open-vsx.org` 同属 Eclipse 基金会运营，已一并写入 `01-ACCEPTANCE-CORE.md` D1 白名单行。
- `img.shields.io` / `raw.githubusercontent.com` 命中全部来自**扩展 readme 内容渲染**（badge、demo.gif），属发布者内容驱动的固有行为（VSCodium 相同），非产品配置出口。
- 注：`main.vscode-cdn.net/extensions/copilotChat.json`（4 次）来自 **dev 形态下在仓的 `extensions/copilot` 扩展**（`byokContribution.ts`，D08 已在 `network-egress-allowlist.txt` 备案）；D08-01 已裁定该扩展**不进出厂产物**（`check-no-copilot-artifacts.sh` 门禁打包）。dev 窗口会加载 extensions/ 下全部在仓扩展，此为 dev-only 现象，非出厂行为。
- `wpad` 为 Chromium 对本机代理发现的探测，非外发。

---

## 2. 实测：搜索 / 安装 / 启用 / 重启持久（验收 1/4）

测试扩展：**`redhat.vscode-yaml`**（Open VSX API 报 license: MIT；发布者 Red Hat）。选择理由：MIT 许可、真实语言扩展（带 main 代码 + language server），能同时验证声明式与代码承载两条激活路径。

实测步骤与证据（dev 形态：worktree `npm run compile` 后 `scripts/apply-mixin.sh` 应用 mixin，`scripts/code.sh` 启动）：

1. **搜索**：Extensions 视图输入 `yaml` → 返回 Open VSX 结果（Red Hat YAML 7.6M 安装量置顶）。截图：`evidence/d15-extensions-search-yaml.png`。
2. **安装**：列表项下拉选 "Install Release Version" → shared process 日志 `Extension installed successfully: redhat.vscode-yaml`（1.24.0 稳定版，非 pre-release）。`extensions.json` 记录 `metadata.source: "gallery"`。
3. **启用**：打开 `test.yaml` → 状态栏语言模式 = **YAML**（由该扩展提供），exthost 日志 `ExtensionService#_doActivateExtension redhat.vscode-yaml, activationEvent: 'onLanguage:yaml'`。
4. **重启持久**：杀进程后以同一 `--user-data-dir/--extensions-dir` 重启两次，`@installed` 仍列出 YAML；再次打开 `test.yaml` 重新激活（新会话 exthost 日志再次记录激活）。扩展目录 `<user-data>/extensions/redhat.vscode-yaml-1.24.0-universal/` 在盘持久。截图：`evidence/d15-extensions-installed-after-restart.png`。
5. **签名验证说明**：日志出现 `Could not load vsce-sign module` → `Extension signature verification is not done`。这是 OSS 构建的固有行为（`@vscode/vsce-sign` 为 MS 专有模块，官方构建才有；VSCodium 同样无签名验证）。**风险裁定**：接受 —— 缓解 = Open VSX 侧 Publisher Agreement + namespace 所有权校验 + sha256 pin（builtInExtensions）。已在本文档显式记录，不声称"有签名验证"。

---

## 3. builtInExtensions 处置结论（验收 7，与 D08-03 交叉）

**裁定：保留三项 js-debug，sha256 pin 不变，不自托管镜像。**

| 扩展 | 版本 | 许可 | sha256 pin（product.json） | Open VSX 实拉 sha256 | 结论 |
|---|---|---|---|---|---|
| ms-vscode.js-debug-companion | 1.1.3 | MIT | `7380a890…de93` | `7380a890…de93` | **一致** |
| ms-vscode.js-debug | 1.117.0 | MIT | `854eeb8a…c7fb8` | `854eeb8a…c7fb8` | **一致** |
| ms-vscode.vscode-js-profile-table | 1.0.11 | MIT | `a962a1e6…48ae9` | `a962a1e6…48ae9` | **一致** |

（2026-09-20 实测：`https://open-vsx.org/vscode/gallery/publishers/ms-vscode/vsextensions/{name}/{version}/vspackage` 全量下载 + `shasum -a 256` 比对。）

- 三项全部 MIT（LICENSE-CLEARANCE §7），无再分发限制；**无需自托管镜像**。
- 构建链变化说明：配置 gallery 后 `build/lib/builtInExtensions.ts` 的 `syncMarketplaceExtension` 走 `fromMarketplace(serviceUrl, …)`，即从 **Open VSX** 拉取并以 `checksumSha256` 校验（pin 一致 → 通过）；gallery 未配置时回退 GitHub。dev 首启日志 `[marketplace] ms-vscode.js-debug@1.117.0 ✔︎` 已实测。
- D10 checklist D6（打包时 sha256 校验拉取 + 清单记录）属 D09 打包落地项，本 issue 不重复实现；本节的实拉比对即为该清单的记录基线。

---

## 4. Agents 窗口扩展白名单（验收 5，checklist E3）

**裁定：`sessionsWindowAllowedExtensions = []`（显式空白名单），overlay 显式 pin，CI 断言防扩大。**

理由：
1. Agent Host 内核是 **in-tree**（`src/vs/platform/agentHost`），Agents 窗口核心功能不依赖任何扩展。
2. 声明式扩展（themes/languages/grammars/keybindings/jsonValidation 等，无 `main`/`browser` 代码）已经由 `canExecuteOnSessionsWindow`（`extensionManifestPropertiesService.ts`）默认放行，无需白名单。
3. 代码承载的第三方扩展在 Agents 窗口默认不激活（`_isDisabledBySessionsWindow`，`extensionEnablementService.ts`）；**目前没有任何一个第三方扩展经过 Agents 窗口适配审查**，白名单为空是唯一诚实默认值。
4. 不引用任何 MS 专有扩展（E3 要求）——空集天然满足，且守卫脚本钉死。

**防扩大断言**：`scripts/check-extension-gallery.sh` 同时断言 (a) overlay 必须显式声明该键（防止上游 root product.json 变更静默生效）、(b) 合并结果必须为 `[]`。已挂 baseline CI（`codex-desktop-baseline.yml` "D15 extension gallery guard"）。负向测试（指向 MS Marketplace / 加宽白名单 / 删除键）均已验证报红。

**运行时实测**：同一 profile 安装 redhat.vscode-yaml（代码承载扩展）后，以 Agents 窗口打开 `test.yaml`：文件正常打开，但 exthost 日志**无** `redhat.vscode-yaml` 激活记录（对照：常规窗口同操作有激活记录）；Agents 窗口仅激活内置扩展（vscode.git、vscode.emmet 等）。截图：`evidence/d15-agents-window-yaml-not-activated.png`。

---

## 5. Workspace trust 默认策略（验收 6）

**裁定：保留上游默认（`security.workspace.trust.enabled` 默认 `true`，`workspace.contribution.ts:799-805`），信任弹窗/Restricted Mode 为出厂行为；`--disable-workspace-trust` 自动化路径不受影响（`argv.ts:195` → `WorkspaceTrustEnablementService` 短路）。不改任何代码。**

实测：
- 全新 profile 打开新文件夹 → **Restricted Mode** banner 出现（"Restricted Mode is intended for safe code browsing…"）。截图：`evidence/d15-workspace-trust-restricted-mode.png`。
- 同 profile 加 `--disable-workspace-trust` 启动 → 无 Restricted Mode（自动化路径可用；launch skill 的 `--disable-workspace-trust` 参数与 `.vscode-test.js` 的默认 launchArgs 均依赖该旗标，均未受影响）。

`extensionsTrust` 相关：扩展签名验证在 OSS 构建不可用（§2 第 5 条）；信任模型 = workspace trust（默认开）+ Open VSX 发布侧审核，不额外引入扩展级信任配置。

---

## 6. Open VSX 义务登记（checklist E2）

- **消费侧**：Open VSX 对用户无统一附加条款；逐扩展遵守其声明许可（registry 对内容许可不负责任，由发布者负责）。产品侧不做"许可过滤"承诺；Extensions 视图为用户显式发起安装，与 VSCodium 同一形态。
- **发布侧（条件触发）**：若未来向 Open VSX 发布自有扩展，须先签署 Open VSX Publisher Agreement（署名、非侵权承诺）且扩展含 OSI 许可。当前**无自有扩展发布计划**，义务未触发。
- **运营风险**：可用性/审核由 Eclipse 基金会承担，无 MS 依赖；服务中断时产品回退语义 = 无市场（VSIX 本地安装仍可用）。

---

## 7. 内置扩展清单裁定（extensions/ 100+）

**裁定：随上游保留全部内置扩展（D08 已排除的 `extensions/copilot` 除外，不进出厂产物）。**

外部服务依赖评估（保留但登记）：

| 扩展 | 外部触点 | 性质 |
|---|---|---|
| `microsoft-authentication` / `github-authentication` | login.microsoftonline.com / github.com | 仅用户显式发起登录时 |
| `github` | api.github.com | 仅用户显式 GitHub 操作时 |
| `json-language-features` | json.schemastore.org（schema 拉取） | 打开含 schema 引用的 JSON 时；上游默认行为，VSCodium 同 |
| `tunnel-forwarding` | tunnels API | 仅用户显式 forward 时 |
| 语言/主题/grammars 类（100+ 大头） | 无 | 纯本地 |

这些产品内默认不主动联系外部服务；D08 出口审计（denylist）持续门禁 MS/GitHub 遥测类出口。

---

## 8. `.vscode-test.js` 与扩展测试兼容性

`.vscode-test.js` 默认 launchArgs 含 `--disable-extensions --disable-workspace-trust`，测试经 `scripts/code.sh` 跑本地构建，**不触达 gallery**；gallery 配置对其无影响。无需改动。

## 9. 附带修复：常规 workbench 窗口 onboarding 崩溃（验收 1 阻塞项）

**问题**：D08 mixin 删除 `defaultChatAgent` 后，`welcomeOnboarding` 的 `onboardingVariationA.ts` 在**模块作用域** `assertDefined(product.defaultChatAgent)`，import 即抛异常，整个常规 workbench  bundle 求值中止（白屏）。D07 后常规窗口虽非默认形态，但 Extensions 视图只在常规窗口——不修则验收 1 无法在真实窗口演示。

**修复**：断言从模块作用域移至 `show()` 入口早退（无 defaultChatAgent 时 onboarding 无意义，直接跳过）；删除未用 import。类型检查通过；常规窗口实测恢复（本文全部实测均在修复后的常规窗口完成）。

## 10. 变更清单与守卫

| 文件 | 变更 |
|---|---|
| `product/product.json` | 新增 `extensionsGallery`（Open VSX）；显式 pin `sessionsWindowAllowedExtensions: []` |
| `scripts/check-extension-gallery.sh` | 新守卫：合并形态断言 gallery 全字段 host ∈ {open-vsx.org}、无 MS Marketplace 主机、白名单 pin [] |
| `.github/workflows/codex-desktop-baseline.yml` | baseline CI 挂接新守卫（D08 审计之后） |
| `src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts` | §9 崩溃修复 |
| `.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md` | D1 白名单行补 Open VSX 两域 |
| `.agents/research/codex-desktop/PRE-RELEASE-CHECKLIST.md` | E1/E2/E3 勾销 + G 段状态记录 |
| `evidence/d15-*.png`（4 张） | 搜索/安装后重启/Agents 不激活/Restricted Mode 截图 |

**守卫负向测试**（本地实测全部报红）：serviceUrl 指向 marketplace.visualstudio.com；白名单加扩展；overlay 删除白名单键。

## 11. 复现配方

```bash
# 准备（worktree）
ln -s <主工作区>/node_modules node_modules && ln -s <主工作区>/build/node_modules build/node_modules
# extensions/**、.vscode/extensions/** 的 node_modules 同法链接；node build/npm/electronTypes.ts
export PATH=<node24>/bin:$PATH
npm run compile

# 静态守卫
bash scripts/check-extension-gallery.sh          # gallery/白名单断言
bash scripts/audit-network-egress.sh             # D08 出口审计（须在编译前/无 dist 产物时跑）

# 实机
bash scripts/apply-mixin.sh
scripts/code.sh --log-net-log=/tmp/netlog.json <workspace>
# Extensions 视图搜 yaml → 安装 redhat.vscode-yaml（Release）→ 打开 test.yaml → 重启复验
# 验收后回滚工作树：git checkout -- product.json resources/
```
