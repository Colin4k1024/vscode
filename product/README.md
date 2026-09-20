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
├── default-settings.json # R12 声明层（见下）
├── extensions.json       # 内置扩展清单（预留给 D09 打包管线；当前全空 = 继承上游）
├── branding-residue-whitelist.txt  # AC8 扫描白名单（仅第三方许可文本）
├── README.md
└── branding/
    ├── icon.svg                 # 占位 logo（自绘几何图形，非上游资产）
    ├── darwin/colincode.icns    # → resources/darwin/code.icns
    ├── win32/colincode.ico      # → resources/win32/code.ico
    │       colincode_70x70.png  # → resources/win32/code_70x70.png
    │       colincode_150x150.png# → resources/win32/code_150x150.png
    ├── linux/colincode.png      # → resources/linux/code.png
    │       colincode.appdata.xml# → resources/linux/code.appdata.xml
    └── app/colincode_*.png      # 通用 PNG 尺寸集，供打包消费者使用（DMG/web/D09）；
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

mixin **不设置** `quality: 'stable'`（否则 `chat.agentHost.codexAgent.enabled` 与
`chat.editor.codex.preferAgentHost` 的 schema 默认 `product.quality !== 'stable'`
会把 Codex 默认关掉）。`default-settings.json` 显式声明两者为 `true`；
`scripts/check-r12-guard.sh` 静态断言：有效 quality ≠ stable、两处 schema
默认保证为 true、声明层不漂移。VS Code 无 product 级 default-settings 机制，
运行时生效靠的是 schema 默认值本身（在非 stable quality 下为 true）。

## dataFolderName 变更的用户可见影响（PR 描述必须复述）

`dataFolderName` 从 `.vscode-oss` 变为 `.colincode`（dev 模式 `~/.colincode-dev`）：
既有 `~/.vscode-oss(-dev)` 下的扩展与设置对新身份**不可见**（观感=数据"丢失"）。
迁移方式：手动拷贝旧目录内容到新目录，或在设置同步开启时重新登录同步。
`sharedDataFolderName: colincode` 同理影响共享数据位置。
