# product/ — OpenAgents fork identity layer (codex-desktop D06, issue #8)

> **占位名声明（重要）**：`OpenAgents` / `open-agents` / `openagents_desktop` /
> `dev.openagents.*` 是**占位产品名**，等待用户确认后**单点替换**（见下文
> “替换占位名”）。本目录是 fork 产品身份的唯一来源；仓库根的 `product.json`
> 保持与上游 microsoft/vscode 逐字节一致。

## 布局（对齐 grok-code-product/product/，验收 10）

| 文件 | 对应 grok-code-product | 本 fork 的语义 |
|---|---|---|
| `product.json` | `product/product.json` | **overlay**（仅 fork 自有字段，~40 行标量），不是 grok 的整文件替换——in-tree fork 下 overlay 的 rebase 冲突面最小（R2） |
| `branding/` | `product/branding/` | 同名结构：`icon.svg` 源 + 各尺寸 PNG + `OpenAgents.icns` + `OpenAgents.ico` + `open-agents.png`（占位图，见 branding/README.md） |
| `default-settings.json` | `product/default-settings.json` | R12 守卫记录（两键 = true）。**1.139 上游没有 product 级 settings 注入机制**（无 `product/default-settings.json` 消费者、无 `product.json#configurationDefaults` 消费者），因此它是被校验的记录而非被应用的配置；真正的执行机制 = 最终 product 不含 `quality` |
| `extensions.json` | `product/extensions.json` | 对齐布局；三个列表均为空（沿用上游 builtInExtensions，D09/D15 才可能增改） |

与 grok-code-product 的差异（书面说明，验收 10）：grok 是 overlay 构建系统
（pristine upstream + 整文件覆盖 `product/product.json` → `upstream/vscode/product.json`）；
本仓库是 in-tree fork（D17 裁定 4：fetch-upstream/apply-patches 的 overlay 语义不适用，
上游同步走 D14 fork-merge）。因此 mixin 语义改为 **shallow merge**（base
product.json ⊕ overlay），`builtInExtensions` 等上游托管字段默认继承。

## 机制：scripts/apply-mixin.mjs（验收 9）

上游 `product.json` 的 `git diff --stat` 保持 **0 行改动**。三层消费路径：

```
scripts/apply-mixin.mjs            # dev：写 product.overrides.json（已被上游 .gitignore 收录）
  └─ src/bootstrap-meta.ts         #   VSCODE_DEV=1 时 shallow Object.assign 进 product 对象
     （renderer/agent host/子进程均从主进程继承该 product）

scripts/apply-mixin.mjs --check    # CI 门：只校验不写（身份/共存/R12/branding 四组断言，硬失败）

scripts/apply-mixin.mjs --out F    # 打包：输出完整合并 product.json（D09 流水线在 gulp 打包前调用）
```

为何不用 `.build/distro/mixin/<quality>`（上游 distro 模式）：该路径只在
Azure DevOps 出厂流水线里执行，dev 启动（`npm run launch`）完全不经过它；
而 `product.overrides.json` 是上游**自带**的 dev 覆盖机制
（`src/bootstrap-meta.ts:22-27` + `.gitignore:27`），零侵入且可逆
（`node scripts/apply-mixin.mjs --revert` 即回到 Code-OSS 身份——满足 issue 的回滚条款）。

**硬失败校验**（D17 对 apply-patches.sh 静默跳过的修正）：
1. 身份字段全量存在且非空（issue #8 范围清单）
2. name 类字段禁含 `VS Code` / `Visual Studio Code` / `Code` / `Codex`（D10 商标约束）
3. 与官方 VS Code 常量、与 Code-OSS base 的共存字段零碰撞（验收 3）
4. **R12**：合并后 `quality` 不得为 `'stable'`；两个注册源仍以
   `product.quality !== 'stable'` 推导默认；`default-settings.json` 两键为 true
5. branding 资产存在

单测侧的等价守卫：`src/vs/platform/agentHost/test/node/productIdentity.test.ts`
（R12 有效默认、urlProtocol 深链解析、clientInfo 标识）。

## R12 备忘（本 issue 最重要的坑）

`chat.agentHost.codexAgent.enabled` 与 `chat.editor.codex.preferAgentHost` 的注册默认都是
`product.quality !== 'stable'`（`agentHostStarter.config.contribution.ts:296`、
`chat.shared.contribution.ts:1028`）。**overlay 绝不能引入 `quality: "stable"`**，
否则 Codex provider 默认不注册（agenthost.log 将看不到 `Registering agent provider: codex`）。
1.139 没有可在 product 层覆盖 configuration defaults 的机制，所以“保持无 quality”
不是偷懒而是唯一正确解。

## dataFolderName 迁移说明（issue 回滚条款要求）

dataFolderName `.vscode-oss` → `.open-agents` 后：

- dev 数据目录变为 `~/.open-agents-dev`（旧 `~/.vscode-oss-dev` 不再被读取——
  用户观感是“数据丢失”，实为并存）。
- 迁移：`cp -a ~/.vscode-oss-dev ~/.open-agents-dev`（或反向复制需要的字段）；
  Windows 还需 `~/.vscode-oss-shared` → `~/.open-agents-shared`（GitHub session 的
  SQLite blob 在 shared 目录）。
- `.agents/skills/launch` 的默认 authed 源 profile 已同步改为 `~/.open-agents-dev`
  （环境变量 `CODE_OSS_DEV_AUTHED_USER_DATA_DIR` 仍可指回旧目录做一次性播种）。

## 替换占位名（品牌定案后）

单点替换清单（全部在 fork-owned 文件内，上游文件零改动）：

| 位置 | 占位值 |
|---|---|
| `product/product.json` | `OpenAgents`（nameShort/nameLong/win32DirName/win32NameVersion/win32ShellNameShort `&OpenAgents`）、`open-agents`（applicationName/dataFolderName 前缀/urlProtocol/linuxIconName）、`.open-agents*`、`dev.openagents.*`、`openagents*` mutex/tunnel |
| `scripts/apply-mixin.mjs` | `OFFICIAL_IDENTITY` 对照表无需动；branding 资产文件名数组 |
| `product/branding/` | `OpenAgents.icns` / `OpenAgents.ico` / `open-agents.png` 文件名与重生成 |
| `src/vs/platform/agentHost/node/codex/codexAgent.ts` | `CLIENT_INFO_NAME='openagents_desktop'`、`CLIENT_INFO_TITLE='OpenAgents Desktop'`（snake_case 产品代号，见 D10 §3） |
| `src/vs/platform/agentHost/test/node/productIdentity.test.ts` | 断言中的同名常量 |
| `.agents/skills/launch/{SKILL.md,scripts/*}` | `~/.open-agents-dev` 默认源 |

替换后运行：`node scripts/apply-mixin.mjs && npm run compile`，单测
`productIdentity.test.ts` 会强制各处一致。
