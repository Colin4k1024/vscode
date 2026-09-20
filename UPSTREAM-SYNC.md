# UPSTREAM-SYNC — 上游同步与版本升级手册（D14 / Issue #16）

> 本文件是 ColinCode（microsoft/vscode fork）跟随两条上游的操作手册：
> **microsoft/vscode**（编辑器本体）与 **openai/codex**（内置 agent SDK）。
> 目标：安全跟随上游，控制 R2（漂移）与 R3（协议偏斜），关闭 G15。
>
> 硬约束：不做自动 rebase / 自动升级机器人；所有同步动作由人按本手册执行。

## 1. 上游基线记录

| 上游 | 跟踪方式 | 当前 pin |
|---|---|---|
| `microsoft/vscode` | `upstream` remote（`https://github.com/microsoft/vscode.git`），跟踪 `main` | `UPSTREAM_COMMIT`（仓库根，裸 commit SHA）= `fb20064c0f4`（2026-09-18，fork 切出点） |
| `openai/codex` | npm 包 `@openai/codex` 三处 pin（见 §2） | `0.155.1`（#44 已按本 runbook 升级） |
| fork 自身发行版本 | `VERSION`（仓库根，裸版本号，grok-code-product 格式） | `0.1.0`（pre-release） |

`UPSTREAM_COMMIT` + `VERSION` 双文件 pin 机制沿用 grok-code-product 格式：纯文本、
单行、无注释（hygiene 的 copyright 检查已在 `build/filters.ts` 中对这两个文件豁免——
加注释头会破坏机器解析）。`VERSION` 是 **ColinCode 自身发行版本**，随发布递增，
与上游版本号解耦；`UPSTREAM_COMMIT` 只在成功完成一次 §3 同步后推进。

配套脚本：

| 脚本 | 用途 |
|---|---|
| `scripts/sync-upstream.sh` | fork-merge 语义的同步编排（移植自 grok-code-product，改造点见 D17 section 4 第 9 项）：fetch → 分支 → merge → pin → 冲突检查 → 总结。`--dry-run` 用 `git merge-tree --write-tree` 在不触碰工作区的前提下预报冲突 |
| `scripts/upstream-drift-report.sh` | 生成上游漂移统计报告（§5），CI 每周自动跑 |
| `scripts/own-change-surface.sh` | 自有改动面统计 + 0-patch 断言（§4/§8） |

## 2. Codex 版本升级 runbook（原子八步）

> 对齐 R3（协议偏斜）。版本升级是**原子三处 pin + 重生成 + 全门禁**的一个提交，
> 参考样例：`817a8d156d9 agentHost: update bundled Codex SDK to 0.153.0`。
> 步骤 1–4 必须在**同一提交**，不允许拆成多个 PR。

```bash
# 0. 确认目标版本
npm view @openai/codex version        # 例：0.155.1

# 1. 改 build/codex/codex-version.txt
echo "0.155.1" > build/codex/codex-version.txt

# 2. 改 build/agent-sdk/agents/codex/package.json + 其 package-lock.json
#    （package.json 里 dependencies."@openai/codex" 改为目标版本，然后：）
(cd build/agent-sdk/agents/codex && npm install --package-lock-only --ignore-scripts)

# 3. 改根 package.json devDependencies."@openai/codex" + 根 package-lock.json
npm install --package-lock-only --ignore-scripts

# 4. 重生成协议客户端（828 个文件）
npm run codex:gen-protocol

# 5. 协议同步门禁必须绿
npm run codex:check-protocol-sync

# 6. replay e2e 全量必须绿（Linux CI 为权威；见 §7 已知差距）
npm run test-agent-host-e2e

# 7. 若有 capture 因协议变更失效：
#    AGENT_HOST_UPDATE_AHP_SNAPSHOTS=1 npm run test-agent-host-e2e
#    然后逐项人工 review snapshot diff —— 不能盲更。

# 8. build/agent-sdk 版本一致性测试必须绿
npm run test-build-scripts   # 含 build/agent-sdk/test/versionSync.test.ts
```

四处版本必须一致（versionSync.test.ts 强制）：`codex-version.txt`、
`build/agent-sdk/agents/codex/package.json`、其 `package-lock.json`、
根 `package.json` devDependencies（+ 根 lockfile）。

**注意**：`scripts/sync-agent-host-protocol.ts` **不属于**本 runbook。它同步的是
兄弟仓库 `agent-host-protocol` 的 AHP 状态协议类型
（→ `src/vs/platform/agentHost/common/state/protocol/`），与 codex app-server 协议
（`codex:gen-protocol` → `protocol/generated/`）是两条独立的供应链。

## 3. VS Code 上游 rebase/merge runbook

### 3.1 频率

- **漂移监控**每周自动跑（§5）；报告非零即评估是否同步。
- 触发同步的条件（任一）：漂移报告热区非零；Codex SDK 升级前（先同步上游，
  减少变量）；上游出现我们依赖的 agentHost/sessions 修复；发布前基线刷新。

### 3.2 操作步骤

```bash
# dry-run 预报冲突（不改工作区、索引、分支与 pin（会 fetch upstream 对象并注册 upstream remote））
bash scripts/sync-upstream.sh --dry-run            # 目标默认 upstream/main

# 实际同步（创建 sync-upstream/<date>-<sha> 分支并 merge --no-commit --no-ff）
bash scripts/sync-upstream.sh [--ref <ref>]

# 有冲突 → 手工解决 → git add -A && git commit
# 干净 → 脚本已推进 UPSTREAM_COMMIT，检查 git diff 后提交
```

### 3.3 rebase/merge 后必跑门禁（已全部实测，2026-09-20，M-series macOS）

| 门禁 | 命令 | 实测耗时 | 实测结果 |
|---|---|---|---|
| transpile（CI compile 代理） | `npm run gulp transpile-client-esbuild transpile-extensions` | ~5s（warm）/ CI 冷跑见 workflow | 绿 |
| clean git state | `bash .github/workflows/check-clean-git-state.sh` | 0.6s | 绿（提交后） |
| 协议同步 | `npm run codex:check-protocol-sync` | 3.1s | 绿 |
| agent-host 单测（含 D12/D13） | `npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"` | 35s | 绿（6648 passing, 56 pending, 0 failing） |
| build 脚本测试（含 versionSync） | `npm run test-build-scripts` | ~11s | 绿*（见 §7 符号链接注意） |
| hygiene | `npm run hygiene` | 40s | 绿（D14 修复了 4 处存量违规后） |
| stylelint | `npm run stylelint` | 1s | 绿（483 文件） |
| eslint | `npm run eslint` | 33s | **红**：43 个存量 warning（见 §6 已知差距） |
| replay e2e | `npm run test-agent-host-e2e` | ~4min | **本地 macOS 红**（50 pass/55 fail，环境性；Linux CI 为权威，见 §7） |

### 3.4 冲突高发区（按自有改动面排序；§4 有逐文件清单）

| 区域 | 自有改动 | 备注 |
|---|---|---|
| `src/vs/platform/agentHost/`（common/node/test） | 15 M + 大量 A | 最高重叠区；`codexAgent.ts` +173/-16 是最大单文件改动 |
| `src/vs/platform/agentHost/test/node/e2e/suites/copilotCoverageSuite.ts` | M | +4/-1 | D15 | 源码改动 | D15 评审发现：scratch 目录清理断言的 retry 预算过紧（CI flake）；e2e 时序断言只能改在测试本体 |
| `src/vs/sessions/` | 4 M + 2 A | 账号菜单、键位 |
| `src/vs/workbench/contrib/chat/` | 6 M + 2 A | `chat.shared.contribution.ts` 已被 `sync-upstream.sh --dry-run` 实测预报冲突（2026-09-20 vs upstream/main） |
| `product.json`（根） | 0 M | D06 mixin 保护：根 product.json 保持 0 diff（`check-product-json-pristine.sh` 把关） |
| `package.json`（根） | 1 M（D14 的 1 行 script alias）+ devDependencies pin | Codex 升级必碰；上游也频繁动 devDependencies |

## 4. 薄覆盖层清单（对齐 R2 / D09 AC12）

口径：`git diff fb20064c0f4..HEAD`（fork 相对上游基线的全部自有改动）。
当前总计：**192 文件**（静态快照：§4.1 为手工维护清单，数字为表实测值；行数差口径 +15580/-984 为 D14 合入时点快照。
全量实时口径以 `scripts/own-change-surface.sh` 输出为准，该脚本含生成目录等本清单声明排除项）；
其中新增（覆盖层）134、修改（源码改动）58（含 25 个测试文件）、删除 0。`patches/` 目录不存在（0 patch，D09 AC12 成立，由
`scripts/own-change-surface.sh` 断言）。上游协议生成目录
（`protocol/generated/` 828 文件）与 `build/codex/` 在基线中已存在（上游 in-tree），
不计入自有改动面。

分类规则：

- **覆盖层**：fork 新增的文件（`product/` mixin、CI workflow、`scripts/`、
  文档、新增测试/模块）。新增文件在 merge 时天然不与上游冲突。
- **源码改动**：修改上游既有文件（M）。每项必须回答"为什么不能走覆盖层"。

58 个源码改动文件的理由汇总（逐文件全表见 §4.1；清单为手工维护的快照，非实时生成——生成时点见本节顶部口径行）：

- **类型/枚举/接口契约本体**（4 个）：`base/common/product.ts`、`platform/window/common/window.ts`、`agentHostSchema.ts`、`meta/codexAccount.ts`——类型成员必须改在定义处，无覆盖层概念。
- **行为逻辑/策略裁决**（11 个）：`agentService.ts`、`codexAgent.ts`、`codexAccountState.ts`、`agentHostCustomizationConfig.ts`、`codexAccountService.ts`、`defaultAccount.ts`、`telemetryService.ts`、`extensionGalleryService.ts`、`agentSessionsWelcome.ts`、`sessionsActions.ts`、`account.contribution.ts`——fork 改变的是运行时行为，不是数据；上游无对应扩展点。
- **上游内嵌默认值的空值守卫/移除**（5 个）：`platform/product/common/product.ts`（移除 `defaultChatAgent`）、`abstractExtensionManagementService.ts`、`extensionsWorkbenchService.ts`、`chatStatusEntry.ts`、`chatWidget.ts`（各 1 行空值守卫）——上游假设 `defaultChatAgent` 必存在，守卫只能写在判读处。
- **入口/contribution 注册**（5 个）：`app.ts`、`agentHostStarter.config.contribution.ts`、`agentHost.contribution.ts`、`chat.shared.contribution.ts`、`chatStatusDashboard.ts`——注册点本体。
- **测试文件**（25 个）：跟随被测源文件演进；上游测试文件无法"覆盖"，只能就地改。
- **构建/工具链/配置**（8 个）：`build/agent-sdk/{README.md,common.ts}`（D02 pin 机制）、`build/filters.ts`（D14 pin 文件 hygiene 豁免）、`build/hygiene.ts`（D15 extensionsGallery 检查 mixin 感知豁免）、根 `package.json`（D14 script alias，1 行）、`.agents/skills/launch/`×3（D06 开发启动脚本，引用 mixin 产品身份）。

注：fork 自有的 CI workflow（baseline/drift）、`scripts/*.sh`、`product/`、文档等均为
**新增文件（覆盖层）**，即使后续被 fork 自己修改，相对上游仍是 A 类——上游没有同名
文件，merge 时不会冲突。

### 4.1 逐文件清单（静态快照，以脚本输出为准）

| 文件 | 变更 | 行数 | 来源 | 分类 | 理由 |
|---|---|---|---|---|---|
| `.agents/goal/codex-desktop.json` | A | +338/-0 | D04 | 覆盖层 | **覆盖层**：编排目标状态 |
| `.agents/research/codex-desktop/00-FINDINGS.md` | A | +390/-0 | D01,D17 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md` | A | +213/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/02-ISSUES.md` | A | +910/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/03-DEDUP.md` | A | +144/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/A-TRACEABILITY.md` | A | +66/-0 | D12 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/BOOTSTRAP.md` | A | +469/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/CODEX-SDK-SUPPLY.md` | A | +86/-0 | D02 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/D07-FORM-DECISION.md` | A | +167/-0 | D07 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/D08-DECISIONS.md` | A | +130/-0 | D08 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/D15-GALLERY.md` | A | +220/-0 | D15 | 覆盖层 | **覆盖层**：D15 裁定与两轮实测证据文档 |
| `.agents/research/codex-desktop/LICENSE-CLEARANCE.md` | A | +352/-0 | D10 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/LIVE-ONLY.md` | A | +54/-0 | D11 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/PRE-RELEASE-CHECKLIST.md` | A | +59/-0 | D10 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/README.md` | A | +78/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/ROUTE-DECISION.md` | A | +307/-0 | D17 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/bootstrap.sh` | A | +100/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/evidence/D01-agents-window.png` | A | bin | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/evidence/d07-first-launch-agents-default.png` | A | bin | D07 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/evidence/d07-first-launch-continue-without-signin.png` | A | bin | D07 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/research/codex-desktop/evidence/d15-agents-window-yaml-not-activated.png` | A | bin | D15 | 覆盖层 | **覆盖层**：第二轮：Agents 窗口不激活未列入扩展（截图） |
| `.agents/research/codex-desktop/evidence/d15-extensions-installed-after-restart.png` | A | bin | D15 | 覆盖层 | **覆盖层**：第二轮：重启后 @installed 仍在列（截图） |
| `.agents/research/codex-desktop/evidence/d15-extensions-search-yaml.png` | A | bin | D15 | 覆盖层 | **覆盖层**：第二轮：Extensions 视图搜索 yaml（截图） |
| `.agents/research/codex-desktop/evidence/d15-gui-extensions-view.txt` | A | txt | D15 | 覆盖层 | **覆盖层**：首轮：Extensions 视图 GUI 记录 |
| `.agents/research/codex-desktop/evidence/d15-installed-extensions.json` | A | txt | D15 | 覆盖层 | **覆盖层**：首轮：安装后扩展清单 |
| `.agents/research/codex-desktop/evidence/d15-netlog-hosts.txt` | A | txt | D15 | 覆盖层 | **覆盖层**：第二轮：四轮 netlog 按主机聚合 |
| `.agents/research/codex-desktop/evidence/d15-openvsx-gallery-trace-cli.log` | A | txt | D15 | 覆盖层 | **覆盖层**：首轮：Open VSX 请求 trace |
| `.agents/research/codex-desktop/evidence/d15-second-round-logs.txt` | A | txt | D15 | 覆盖层 | **覆盖层**：第二轮：安装/激活/重启/Agents 对照日志摘录 |
| `.agents/research/codex-desktop/evidence/d15-workspace-trust-restricted-mode.png` | A | bin | D15 | 覆盖层 | **覆盖层**：第二轮：Restricted Mode 默认出现（截图） |
| `.agents/research/codex-desktop/submit.sh` | A | +263/-0 | D01 | 覆盖层 | **覆盖层**：调研与决策文档（含 bootstrap/提交脚本） |
| `.agents/skills/launch/SKILL.md` | M | +4/-4 | D06 | 源码改动 | Dev-tool 文档，引用产品名/数据目录；随 D06 品牌更新（非发布运行时） |
| `.agents/skills/launch/scripts/launch.ps1` | M | +32/-10 | D06 | 源码改动 | 开发启动脚本须传入 mixin 的 dataFolderName/应用名；shell 脚本无覆盖层挂点 |
| `.agents/skills/launch/scripts/launch.sh` | M | +27/-3 | D06 | 源码改动 | 同上（POSIX 版） |
| `.github/workflows/codex-desktop-baseline.yml` | A | +253/-0 | D01,D06,D08,D11,D14 | 覆盖层 | **覆盖层**：fork 自有 CI（新增文件，不与上游 workflow 同名） |
| `.github/workflows/codex-upstream-drift.yml` | A | +40/-0 | D14 | 覆盖层 | **覆盖层**：D14 漂移监控 workflow（新文件，不与上游同名） |
| `.goal-state/STATE.md` | A | +33/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d03-spec.md` | A | +73/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d04-spec.md` | A | +45/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d06-spec.md` | A | +45/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d08-spec.md` | A | +41/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d11-spec.md` | A | +35/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d12-spec.md` | A | +47/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/d13-spec.md` | A | +30/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/1.md` | A | +140/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/10.md` | A | +48/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/11.md` | A | +74/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/13.md` | A | +51/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/14.md` | A | +57/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/15.md` | A | +55/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/16.md` | A | +55/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/17.md` | A | +45/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/18.md` | A | +55/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/5.md` | A | +49/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/6.md` | A | +46/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/7.md` | A | +51/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/8.md` | A | +64/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `.goal-state/issues/9.md` | A | +73/-0 | D03,D13 | 覆盖层 | **覆盖层**：issue 与 D-spec 编排状态 |
| `UPSTREAM-SYNC.md` | A | +450/-0（自引用行，随本文件编辑固有漂移） | D14,D15 | 覆盖层 | **覆盖层**：D14 本手册（新增文档） |
| `UPSTREAM_COMMIT` | A | +1/-0 | D14 | 覆盖层 | **覆盖层**：D14 上游 pin（grok-code-product 格式，裸 SHA） |
| `VERSION` | A | +1/-0 | D14 | 覆盖层 | **覆盖层**：D14 fork 发行版本 pin（grok-code-product 格式） |
| `build/agent-sdk/README.md` | M | +31/-0 | D02 | 源码改动 | agent-sdk pin 机制文档（构建期，非运行时） |
| `build/agent-sdk/common.ts` | M | +33/-2 | D02 | 源码改动 | D02 SDK 打包逻辑（CDN 端点等）；构建期工具链，无产品覆盖层机制可承载 |
| `build/agent-sdk/test/cdnEndpoint.test.ts` | A | +85/-0 | D02,D14 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `build/filters.ts` | M | +5/-0 | D14 | 源码改动 | D14：hygiene copyright 豁免 UPSTREAM_COMMIT/VERSION（机器可读 pin 文件不能加注释头）；filters.ts 是上游既有的豁免注册表 |
| `build/hygiene.ts` | M | +26/-2 | D15 | 源码改动 | D15：hygiene 的 extensionsGallery 检查改为 mixin 感知（工作树应用态放行、提交/暂存态仍红）；该检查是上游对产品 gallery 的硬约束，只能改在检查本体；覆盖层机制无法拦截构建脚本 |
| `package.json` | M | +1/-0 | D14 | 源码改动 | D14：新增 1 行 `codex:check-protocol-sync` script alias；package.json 是冲突高发区，改动压到最小 |
| `product/README.md` | A | +98/-0 | D06,D08 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding-residue-whitelist.txt` | A | +16/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_1024x1024.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_128x128.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_16x16.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_256x256.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_32x32.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_48x48.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_512x512.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/app/colincode_64x64.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/darwin/colincode-file.icns` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/darwin/colincode.icns` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/darwin/fileicon.svg` | A | +26/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/icon.svg` | A | +21/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/inno-big.svg` | A | +22/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/linux/colincode.appdata.xml` | A | +12/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/linux/colincode.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/server/code-192.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/server/code-512.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/server/favicon.ico` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/VisualElementsManifest.xml` | A | +9/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/colincode.ico` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/colincode_150x150.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/colincode_70x70.png` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-100.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-125.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-150.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-175.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-200.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-225.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-big-250.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-100.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-125.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-150.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-175.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-200.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-225.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/branding/win32/inno-small-250.bmp` | A | bin | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/default-settings.json` | A | +4/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/extensions.json` | A | +5/-0 | D06 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `product/product.json` | A | +48/-0 | D06,D07,D08,D15 | 覆盖层 | **覆盖层**：D06 产品 mixin（品牌/图标/默认设置），apply-mixin.sh 在构建/dev 前合并，上游 product.json 保持 0 diff |
| `scripts/apply-mixin.sh` | A | +188/-0 | D06,D08,D14 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/audit-network-egress.sh` | A | +173/-0 | D08,D15 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件）；D15 追加合并配置 gallery 断言（Open VSX 前缀 + MS Marketplace 禁令 + G9 存在性门） |
| `scripts/check-branding-identity.sh` | A | +86/-0 | D06 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/check-branding-residue.sh` | A | +105/-0 | D06 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/check-no-copilot-artifacts.sh` | A | +52/-0 | D08,D14 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/check-product-json-pristine.sh` | A | +19/-0 | D06 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/check-r12-guard.sh` | A | +123/-0 | D06 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/generate-icons.sh` | A | +134/-0 | D06,D14 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/network-egress-allowlist.txt` | A | +62/-0 | D08 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/own-change-surface.sh` | A | +67/-0 | D14 | 覆盖层 | **覆盖层**：D14 改动面统计 + 0-patch 断言 |
| `scripts/scan-credential-residue.sh` | A | +62/-0 | D08 | 覆盖层 | **覆盖层**：fork 自有工具脚本（新增文件） |
| `scripts/sync-upstream.sh` | A | +174/-0 | D14 | 覆盖层 | **覆盖层**：D14 fork-merge 同步编排（移植自 grok-code-product） |
| `scripts/upstream-drift-report.sh` | A | +126/-0 | D14 | 覆盖层 | **覆盖层**：D14 漂移报告生成器 |
| `scripts/verify-beta-gates.sh` | A | +153/-0 | D09,D15 | 覆盖层 | **覆盖层**：D09 发布门禁链；D15 起 gate 4 增加 gallery 存在性硬门（与 audit-network-egress.sh 对齐） |
| `src/vs/base/common/product.ts` | M | +14/-1 | D07,D08 | 源码改动 | 产品接口契约：`defaultWindow?` 字段 + `defaultChatAgent` 改可选；类型必须改在接口本体 |
| `src/vs/code/electron-main/app.ts` | M | +14/-0 | D07 | 源码改动 | 启动入口分支（bare launch → Agents 窗口）；进程入口无覆盖层挂点 |
| `src/vs/code/node/agentsWindowStartup.ts` | A | +61/-0 | D07 | 覆盖层 | D07：新增模块（append-only），启动判定逻辑独立成文件以缩小 app.ts 改动面 |
| `src/vs/code/test/node/agentsWindowStartup.test.ts` | A | +101/-0 | D07 | 覆盖层 | 上述模块的测试（新增） |
| `src/vs/code/test/node/extensionGallery.test.ts` | A | +105/-0 | D15 | 覆盖层 | **覆盖层**：D15 gallery 裁定 pin 测试（新增文件） |
| `src/vs/platform/agentHost/common/agentHostCustomizationConfig.ts` | M | +29/-2 | D04,D05 | 源码改动 | D04/D05 默认 provider/权限策略的配置解析；策略是行为逻辑不是数据 |
| `src/vs/platform/agentHost/common/agentHostSchema.ts` | M | +1/-1 | D04 | 源码改动 | 配置 schema 默认值；schema 定义本体 |
| `src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts` | M | +3/-2 | D04,D06 | 源码改动 | starter 配置贡献点默认值；contribution 注册本体 |
| `src/vs/platform/agentHost/common/agentService.ts` | M | +48/-4 | D04,D05 | 源码改动 | D04/D05 provider 策略裁决逻辑；核心服务行为 |
| `src/vs/platform/agentHost/common/meta/codexAccount.ts` | M | +14/-0 | D03 | 源码改动 | D03 OpenAI 原生登录的账号元数据类型；协议元数据本体 |
| `src/vs/platform/agentHost/node/codex/codexAccountState.ts` | M | +4/-1 | D03 | 源码改动 | D03 登录状态机；运行时行为 |
| `src/vs/platform/agentHost/node/codex/codexAgent.ts` | M | +173/-16 | D03,D04,D05,D08,D13,D14 | 源码改动 | 最大源码改动（+173/-16）：D03 登录、D04 去 GitHub 耦合、D05 策略、D08 clientInfo 身份与遥测隔离、D13 负向路径；D14 追加 1 字符注释修复（§→section，hygiene）。会话宿主核心行为，无扩展点可覆盖 |
| `src/vs/platform/agentHost/test/common/agentService.test.ts` | M | +57/-0 | D07 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/common/codexAccount.test.ts` | M | +82/-0 | D03 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/common/openSessionLink.test.ts` | M | +15/-0 | D06 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/agentFeedbackServerTools.test.ts` | M | +38/-0 | D04 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/agentHostCatalogReconciliationService.test.ts` | M | +54/-0 | D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/agentHostOrchestrationGuards.test.ts` | A | +416/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/agentHostPullRequestOperationHandler.test.ts` | M | +32/-5 | D04 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/agentService.test.ts` | M | +154/-0 | D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/baselines/d12-i4-chat-entries-writers.json` | A | +11/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/baselines/d12-i8-codex-host-state-imports.json` | A | +4/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexAccountState.test.ts` | M | +79/-2 | D03 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexAgent.test.ts` | M | +432/-1 | D04,D05 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexAppServerClient.test.ts` | M | +128/-0 | D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexApprovalInvariants.test.ts` | A | +648/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexCaptureInvariantScanner.test.ts` | A | +241/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexCreateChat.test.ts` | M | +1/-1 | D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexD13CrashRecovery.test.ts` | A | +668/-0 | D13 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexIdentityInvariants.test.ts` | A | +247/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexLaunchConfig.test.ts` | M | +130/-1 | D05,D08 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexModelRefresh.test.ts` | M | +278/-8 | D03,D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexProxyService.test.ts` | M | +33/-0 | D08 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexSessionConfigKeys.test.ts` | M | +21/-1 | D05 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/codex/codexThreadCoordination.test.ts` | A | +212/-0 | D13 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/codex/codexTurnLifecycleInvariants.test.ts` | A | +597/-0 | D12 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/e2e/captures/codex-a-client-tool-call-with-an-empty-result-body-is-backfilled-before-it-reaches-the-model.yaml` | A | +35/-0 | D11 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/e2e/captures/codex-a-failing-mcp-server-surfaces-an-error-state-without-blocking-the-turn.yaml` | A | +12/-0 | D11 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/e2e/captures/codex-an-ambient-codex-home-override-does-not-leak-into-the-agent-host-or-provider-processes.yaml` | A | +12/-0 | D11 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/agentHost/test/node/e2e/coverage/summary.json` | M | +1273/-855 | D11 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/e2e/harness/agentHostE2ETestHarness.ts` | M | +20/-0 | D11 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/e2e/providers/codexAgentHostE2E.integrationTest.ts` | M | +312/-4 | D11 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/e2e/suites/agentHostE2ESuites.ts` | M | +4/-0 | D11 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/platform/agentHost/test/node/e2e/suites/replayStrictnessSuite.ts` | A | +105/-0 | D11 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts` | M | +1/-1 | D08 | 源码改动 | D08：`defaultChatAgent` 缺失时的空值守卫（1 行）；上游逻辑假设其必存在 |
| `src/vs/platform/extensionManagement/common/extensionGalleryService.ts` | M | +14/-10 | D08 | 源码改动 | D08：画廊/遥测出口隔离（+14/-10）；网络出口是行为逻辑 |
| `src/vs/platform/product/common/product.ts` | M | +3/-15 | D08 | 源码改动 | D08：OSS 默认 product 中移除 `defaultChatAgent`（-15 行）；上游内嵌默认值只能改本体 |
| `src/vs/platform/telemetry/common/telemetryService.ts` | M | +5/-1 | D08 | 源码改动 | D08：遥测默认级别改为产品未声明 enableTelemetry 时 OFF；启动默认行为 |
| `src/vs/platform/window/common/window.ts` | M | +3/-0 | D07 | 源码改动 | D07：`AgentsWindowOpenSource.StartupDefault` 枚举值；枚举定义本体 |
| `src/vs/sessions/contrib/accountMenu/browser/account.contribution.ts` | M | +3/-0 | D03 | 源码改动 | D03：账号菜单对 device-flow 字段的 diff；UI 逻辑 |
| `src/vs/sessions/contrib/providers/agentHost/test/browser/localAgentHostSessionsProvider.test.ts` | M | +45/-0 | D13 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/sessions/contrib/providers/agentHost/test/browser/sessionTypeAuthRequirement.test.ts` | M | +18/-1 | D04 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/sessions/contrib/sessions/browser/sessionsActions.ts` | M | +18/-2 | D07 | 源码改动 | D07：Cmd/Ctrl+G 全局线程搜索键位（ISS-057 对齐）；键位注册本体 |
| `src/vs/sessions/contrib/sessions/test/browser/sessionsPickerKeybinding.test.ts` | A | +54/-0 | D07 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/sessions/test/browser/openInVSCodeUtils.test.ts` | A | +107/-0 | D07 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/sessions/test/browser/sessionsAuthGate.test.ts` | M | +76/-1 | D04 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHost.contribution.ts` | M | +2/-0 | D05 | 源码改动 | D05：provider 注册策略（+2 行）；contribution 本体 |
| `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCodexDefaultsContribution.ts` | A | +60/-0 | D05 | 覆盖层 | 新增文件 |
| `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts` | M | +15/-4 | D04,D05,D06 | 源码改动 | D04/D05/D06：默认 provider 接线与品牌入口；**已实测为冲突高发区**（sync-upstream dry-run 预报冲突） |
| `src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusDashboard.ts` | M | +28/-4 | D08 | 源码改动 | D08：状态栏去 Copilot 化（+28/-4）；UI 逻辑 |
| `src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusEntry.ts` | M | +1/-1 | D08 | 源码改动 | D08：`defaultChatAgent` 空值守卫（1 行） |
| `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` | M | +1/-1 | D08 | 源码改动 | D08：匿名使用条款横幅守卫（1 行） |
| `src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostCodexDefaultsContribution.test.ts` | A | +153/-0 | D05 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/workbench/contrib/chat/test/browser/chatSessions/chatSessionsService.test.ts` | M | +30/-0 | D04 | 源码改动(测试) | 随对应源文件更新的测试/数据 |
| `src/vs/workbench/contrib/chat/test/browser/codexProviderGatesConfiguration.test.ts` | A | +46/-0 | D07 | 覆盖层 | 测试（新增文件）：D03/D11/D12/D13 验收套件；新增文件天然无合并冲突面 |
| `src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts` | M | +1/-1 | D08 | 源码改动 | D08：`defaultChatAgent` 空值守卫（1 行） |
| `src/vs/workbench/contrib/welcomeAgentSessions/browser/agentSessionsWelcome.ts` | M | +5/-4 | D08 | 源码改动 | D08：欢迎页去 Copilot 假设（+5/-4）；UI 逻辑 |
| `src/vs/workbench/services/accounts/browser/defaultAccount.ts` | M | +25/-6 | D08 | 源码改动 | D08：默认账号服务去 GitHub 假设（+25/-6）；服务行为 |
| `src/vs/workbench/services/agentHost/browser/codexAccountService.ts` | M | +70/-3 | D03 | 源码改动 | D03：OpenAI 原生账号服务（+70/-3）；服务行为 |
| `src/vs/workbench/services/agentHost/test/browser/codexAccountService.test.ts` | M | +131/-5 | D03 | 源码改动(测试) | 随对应源文件更新的测试/数据 |

共 192 文件：覆盖层(新增) 134、源码改动 33、源码改动(测试) 25。

## 5. 漂移监控

`.github/workflows/codex-upstream-drift.yml`：每周一 02:00 UTC + 手动触发，
调用 `scripts/upstream-drift-report.sh` 产出 Markdown 报告并上传为
`upstream-drift-report` artifact（保留 90 天）。报告含：pin 之后上游 commit 数、
热区（`agentHost/node/codex/`、`agentHost/`、`sessions/`、`product.json`、
`package.json`、全树）逐项 diff 统计、热区最近 commit 清单、rebase 优先级提示。

首次报告已本地产出（2026-09-20）：pin 后上游 7 个 commit；`agentHost/` +39/-134、
`sessions/` +101/-1、`agentHost/node/codex/` 0、全树 38 文件 +1106/-255。

## 6. CI 必过门禁清单（PR 实际生效面）

**关键事实**：上游 `pr.yml`（含 compile/hygiene/eslint/protocol-sync 等）使用
Microsoft 自托管 runner（`runs-on: [self-hosted, 1ES.Pool=...]`），**在本 fork 上
永远不会被调度**。fork 上实际生效的 PR 门禁只有
`.github/workflows/codex-desktop-baseline.yml`（GitHub-hosted runner，
`on: pull_request → main`）。D14 把门禁集合补齐到该 workflow：

| 门禁 | 位置 | 状态 |
|---|---|---|
| bootstrap.sh shellcheck | baseline `linux` job | 生效（D01） |
| D06 产品 mixin 三守卫（pristine/branding/R12） | baseline `linux` job | 生效（D06） |
| transpile + clean-git-state | baseline `linux` job | 生效（D01） |
| **codex:check-protocol-sync --if-changed --base** | baseline `linux` job（D14 接入；脚本本就支持 --if-changed/--base，pr.yml 有同款步骤但不在 fork 生效） | 生效（D14） |
| agent-host 单测（含 D12 不变量、D13 负向） | baseline `linux` job | 生效（D01/D11） |
| replay e2e | baseline `agent-host-e2e` job | 生效（D11） |
| **build 脚本测试（含 versionSync.test.ts）** | baseline `linux` job（D14 新增） | 生效（D14） |
| **hygiene** | baseline `linux` job（D14 新增） | 生效（D14） |
| **stylelint** | baseline `linux` job（D14 新增） | 生效（D14） |

`--if-changed` 行为（AC3）：PR 未触碰 `protocol/generated/**` 或
`build/codex/codex-version.txt` → 跳过（exit 0）；触碰 → 执行完整重生成比对。
已双向实测（见 §9）。

**已知差距（eslint）**：全仓 eslint 当前在 main 上有 43 个存量 warning
（D07 `agentsWindowStartup.test.ts` 的 import 层级限制；D12/D13 测试的
bracket-notation/双引号风格），exit 1。这些 warning 的修法涉及测试对私有成员的
访问方式（bracket 是有意为之），属于 D07/D12/D13 的交付物范围，D14 不越权改写。
**eslint 暂不纳入必过集合**；建议后续 issue：清理 43 个 warning 后接入 baseline
workflow（加 `npm run eslint` 一步即可）。

## 7. 已知环境差距

- **replay e2e 本地 macOS 红**：`npm run test-agent-host-e2e` 在本机 50 pass /
  55 fail（90s notification timeout，turn 以 `chat/error` 结束）。本 diff 为零运行时
  改动，失败与 D14 无关；疑因 darwin-arm64 codex 二进制与 Linux 录制 capture 的
  平台差异（CI 权威门禁是 Linux 上的 `agent-host-e2e` job，D11 合并时绿）。
  建议后续 issue 排查本地 replay 确定性。runbook 步骤 6 以 CI 结果为准。
- **build 测试的 node_modules 符号链接**：worktree 用符号链接共享主目录
  node_modules 时，`build/next` 的 3 个打包测试因真实路径前缀校验失败
  （dev-tunnels shim 检查）——这是符号链接假象，真实安装（CI）下通过。
  D14 相关的 agent-sdk/codex 测试（versionSync、checkProtocolSync、cdnEndpoint）
  不受此影响，全部绿。

## 8. 自有改动面统计（对齐 D09 AC12）

`bash scripts/own-change-surface.sh` 输出（2026-09-20 实测）：

```
commits ahead of pin:      73
files changed (total):     178
  added   (overlay-class): 122
  modified (source-class): 56  (of which under src/,build/,extensions/: 52)
  deleted:                 0
line churn:                15580 insertions(+), 984 deletions(-)
patches/ entries:          0
OK: 0 patch files - D09 AC12 invariant holds.
```

（数字为 D14 提交后的实测值；后续演进以脚本实时输出为准。）

## 9. 实操验证记录（AC2）

2026-09-20：npm 上 `@openai/codex` 已有新版本（latest `0.155.1`，当前 pin
`0.153.0`）。按 D14 硬约束（纯文档 + CI + scripts，不改运行时源码），本 PR 不落地
真实升级提交；改为**对当前版本逐步真实执行 runbook 验证幂等性**：

| 步骤 | 执行 | 结果 |
|---|---|---|
| 1 pin 文件重写 0.153.0 | `echo 0.153.0 > build/codex/codex-version.txt` | git diff 为空（幂等） |
| 2 agent-sdk lock 刷新 | `npm install --package-lock-only --ignore-scripts`（build/agent-sdk/agents/codex） | 0.4s，lock 无 diff |
| 3 根 lock 刷新 | `npm install --package-lock-only --ignore-scripts`（根） | 0.9s，lock 无 diff |
| 4 协议重生成 | `npm run codex:gen-protocol` | 3.2s，写出 827 文件（+ 保留 README = 828），git status 0 diff（字节级幂等） |
| 5 协议同步门禁 | `npm run codex:check-protocol-sync` | 3.1s 绿 |
| 6 replay e2e | `npm run test-agent-host-e2e` | 本地 macOS 红（见 §7）；runbook 以 Linux CI 为权威 |
| 7 snapshot 更新 | 无 capture 失效（无协议变更），跳过 | n/a |
| 8 versionSync | `npm run test-build-scripts`（agent-sdk/codex 范围） | 绿（10/10） |

负向验证（AC3/AC4）：

- `--if-changed` 跳过：本分支（不改 protocol 输入）`--if-changed --base origin/main`
  → "No codex protocol generation inputs changed ... skipping"，exit 0。
- `--if-changed` 执行：临时提交改动 `codex-version.txt` → 检测到输入变更并执行
  完整比对（探针提交已移除）。
- versionSync 负向：把 `build/agent-sdk/agents/codex/package.json` 临时改成
  0.154.0 → 测试按预期失败（"An agent SDK version pin drifted"），已还原。
- `sync-upstream.sh --dry-run`：对 `origin/main` → 已合并，exit 0；对
  `upstream/main` → 预报 1 个冲突文件（`chat.shared.contribution.ts`，验证 §3.4
  热区判断），exit 1，工作区/索引/pin 全程不变。

**声明**：本 PR 无 Codex 版本升级落地；runbook 为逐步真实执行的空转验证（幂等性
确认）。npm 上存在可升级版本（0.155.1），真实升级应按 §2 单独立项执行。
