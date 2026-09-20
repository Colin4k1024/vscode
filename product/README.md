# ColinCode product mixin (D06 / Issue #8)

> **品牌为工作代号**：`ColinCode` 是占位代号。最终定名 = 改本目录 `product.json` 单文件
> （+ 重跑 `scripts/generate-icons.sh` 如需换图标），无需触碰任何其他源文件。

本目录是 ColinCode 的产品身份 mixin（覆盖层）。上游仓库根部的 `product.json`
**保持 0 diff**（`scripts/check-product-json-pristine.sh` 把关，AC9）；品牌身份在
构建 / dev 启动前由 `scripts/apply-mixin.sh` 合并进工作树。

## 布局

```text
product/
├── product.json          # 覆盖层：仅品牌身份字段；未列字段继承上游
├── default-settings.json # R12 声明记录（declarative record，非运行时机制，见下）
├── extensions.json       # 内置扩展清单（预留给 D09 打包管线；当前全空 = 继承上游）
├── branding-residue-whitelist.txt  # AC8 扫描白名单（仅第三方许可文本）
├── README.md
└── branding/
    ├── icon.svg                      # 占位 logo（自绘几何图形，非上游资产）
    ├── inno-big.svg                  # Inno 安装向导横幅（高条形）
    ├── darwin/colincode.icns         # → resources/darwin/code.icns
    │       fileicon.svg              # 文件类型文档图标模板（文档 + 品牌 mark）
    │       colincode-file.icns       # → resources/darwin/*.icns（28 个文件类型槽位，
    │                                 #   code.icns 除外；round-1 M1，消除文档图标内的上游 logo）
    ├── win32/colincode.ico           # → resources/win32/code.ico
    │       colincode_70x70.png       # → resources/win32/code_70x70.png（真实 70×70）
    │       colincode_150x150.png     # → resources/win32/code_150x150.png（真实 150×150）
    │       VisualElementsManifest.xml# → resources/win32/VisualElementsManifest.xml
    │                                 #   （ShortDisplayName=ColinCode，round-1 M1）
    │       inno-{big,small}-*.bmp    # → resources/win32/（14 个向导位图，逐 DPI 档渲染）
    ├── server/code-192.png           # → resources/server/code-192.png
    │       code-512.png              # → resources/server/code-512.png
    │       favicon.ico               # → resources/server/favicon.ico
    ├── linux/colincode.png           # → resources/linux/code.png
    │       colincode.appdata.xml     # → resources/linux/code.appdata.xml
    └── app/colincode_*.png           # 通用 PNG 尺寸集，供打包消费者使用（DMG/web/D09）；
                                    # resources/app/ 是构建期生成目录，mixin 不向仓库工作树写入
```

与 `grok-code-product/product/` 的对齐（AC10）：顶层四件套
（`product.json` + `default-settings.json` + `extensions.json` + `branding/`）一致；
`branding/` 内部按 D06 规格分为 `{darwin,win32,linux,app}/` 平台子目录
（grok 为平铺），子目录与 VS Code `resources/` 槽位一一对应，拷贝规则见
`scripts/apply-mixin.sh`。`default-settings.json` 在 grok 中拷贝目标不存在、
实际从未生效（静默跳过缺陷）；本 mixin 改为**校验 + 守卫**语义，不继承该缺陷。

## 使用

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
bash scripts/generate-icons.sh   # 从 icon.svg 再生成各平台图标（改 logo 后）
bash scripts/apply-mixin.sh      # 应用 mixin 到工作树（失败即硬失败）
bash scripts/apply-mixin.sh --check   # CI 门禁：验证 mixin 已完整应用
# 回滚：
git checkout -- product.json resources/
```

合并语义对齐 `build/azure-pipelines/distro/mixin-quality.ts`：覆盖层键胜出；
`builtInExtensions` 只接受 `{include, exclude}` 对象形式（数组形式硬失败）。

## R12（最重要的一条守卫）

mixin **不设置** `quality: 'stable'`，且两处 schema 默认已改为**字面量 `true`**
（`agentHostStarter.config.contribution.ts` 的 `chat.agentHost.codexAgent.enabled`、
`chat.shared.contribution.ts` 的 `chat.editor.codex.preferAgentHost`）——不再从
`product.quality` 推导，品牌产品无条件默认启用 Codex agent host。
`scripts/check-r12-guard.sh` 静态断言：有效 quality ≠ stable、两处 schema 默认
为字面量 `true`（拒绝任何表达式推导）、声明记录不漂移。

`default-settings.json` 是 **R12 声明记录（declarative record）**，不是运行时机制：
VS Code 不存在 product 级 default-settings 加载链路，该文件不会被任何运行时读取。
它的唯一作用是与源码 schema 默认值交叉校验（guard 脚本在两者漂移时硬失败）。
运行时生效完全依赖上述两处源码默认值本身。

## 渠道声明与已知残留（D06 round-1）

- **appx / Microsoft Store 渠道禁用**：本分支不打 Store 包，
  `resources/win32/appx/AppxManifest.xml` 中的 Microsoft Publisher 身份残留
  因此不进入任何分发产物，不需要品牌化（若未来启用 Store 渠道，需先重开此项）。
- **win32 文件类型图标（`resources/win32/*.ico`，28 个文件关联图标）**：
  仍含上游 logo，属已知残留。生成成本评估结论：win32 文件关联图标需要
  逐类型差异化（Finder/资源管理器不叠加扩展名标签），占位模板替换会降低
  可用性，故本轮不动；跟踪：最终定名换真实 logo 时随 generate-icons.sh
  统一重出（darwin 侧 28 个 .icns 已在 round-1 用文档模板 + 品牌 mark 替换）。

## dataFolderName 变更的用户可见影响（PR 描述必须复述）

`dataFolderName` 从 `.vscode-oss` 变为 `.colincode`（dev 模式 `~/.colincode-dev`）：
既有 `~/.vscode-oss(-dev)` 下的扩展与设置对新身份**不可见**（观感=数据"丢失"）。
迁移方式：手动拷贝旧目录内容到新目录，或在设置同步开启时重新登录同步。
`sharedDataFolderName: colincode` 同理影响共享数据位置。
