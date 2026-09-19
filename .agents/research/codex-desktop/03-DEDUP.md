# 提交前重复 Issue 检查报告

检查时间：2026-09-19
检查方式：`gh` CLI 只读查询。**本次调研未创建、未修改、未删除任何 GitHub 对象。**

---

## 1. 目标仓库检查

计划提交到 **`Colin4k1024/vscode`**（当前工作目录、代码变更落地处）。

```bash
gh issue list -R Colin4k1024/vscode --state all --limit 50
# → 空输出（0 个 issue）

gh pr list -R Colin4k1024/vscode --state all --limit 20
# → 空输出（0 个 PR）

gh api repos/Colin4k1024/vscode -q '{has_issues,has_discussions,has_projects}'
# → {"has_discussions":false,"has_issues":true,"has_projects":true}

gh api repos/Colin4k1024/vscode/milestones
# → []

gh label list -R Colin4k1024/vscode --limit 20
# → 仅 10 个 GitHub 默认 label：
#   accessibility / bug / documentation / duplicate / enhancement /
#   good first issue / help wanted / invalid / question / wontfix

git branch -a
# → main, remotes/origin/HEAD -> origin/main, remotes/origin/main（无 feature 分支）
```

**结论：目标仓库完全干净，不存在任何重复 Issue。** 需先创建 label（见 `02-ISSUES.md` 顶部清单）。

---

## 2. 相邻仓库检查（`Colin4k1024/codex`）

```bash
gh issue list -R Colin4k1024/codex --state all --limit 100
# → #1–#29，全部带 label `harness`，全部 OPEN，创建于 2026-09-09

gh label list -R Colin4k1024/codex
# → 默认 10 个 + harness(#5319E7) / P0(#B60205) / P1(#D93F0B) / P2(#FBCA04)
```

### 2.1 性质判定：**不是重复**

29 个 issue 均由 `HARNESS_IMPLEMENTATION_TASKS.md` 拆分而来（总体设计 `HARNESS_INTEGRATION_DESIGN.md`），目标是：

> 在 `codex-rs/` 内新建 `harness` + `harness-runtime` 两个 crate，做一个多角色工作流 CLI 运行时
> （bundle manifest / DAG 调度器 / AgentExecutor / VerificationExecutor / artifact 交接 / 崩溃对账）。

代码基线：`harness-demo@4c0f51f8` + `Codex@ac192cd`。

本 Epic 的目标是：**在 VS Code fork 里启用/去耦/品牌化/打包已有的 Codex agentHost 集成，做成自有桌面 app**。

→ **不同仓库、不同交付物、不同代码路径。不构成重复。**

### 2.2 但有 6 个在 app-server 协议语义上高度相邻 —— 必须交叉引用，不得重复推导

| 已有 issue | 相邻结论 | 本 Epic 对应 | 处理方式 |
|---|---|---|---|
| **#1 H01** 验证进程内会话客户端 | `thread/start → turn/start → notifications → terminal turn`；审批/用户输入/断连/shutdown 的处理位置 | **D02、D12** | `Related:` 引用；D12 的 A1/A3 段直接复用其结论 |
| **#2 H02** 验证 gate 权限与平台限制 | read-only/workspace/admin 限制；**"进程在运行但状态已 cancelled" 不得出现**；Windows 有界停止 | **D05、D13** | `Related:` 引用；已写入 `01-ACCEPTANCE-CORE.md` A1.4 与 D13 验收 1 |
| **#3 H03** 验证恢复与事件处理契约 | 重连后事件缺口；`uncertain` 定义；**不能把 JSON-RPC request ID 当持久化幂等键**；独立 event pump 持续 drain | **D12、D13** | `Related:` 引用；已写入 C2.4 与 D13 验收 2 |
| **#19 H19** 崩溃对账与 resume | lease/generation、`running` attempt 复查、无证据即 `uncertain`、并发 resume 只有一方能执行 | **D13** | `Related:` 引用；对应 C1.7 / C2.x / C3.x |
| **#20 H20** 等待输入的可恢复闭环 | **澄清请求与权限批准两类不可互相替代**；答案是数据不是配置/权限覆盖 | **D12、D13** | `Related:` 引用；已写入 A3.8 |
| **#21 H21** cancel / Ctrl-C / 退出清理 | `cancelling → cancelled` 可观察；不得只 kill worker 就假设工具已退出；完成停止后才释放 lease | **D13** | `Related:` 引用；已写入 A1.4 / D16 / D13 验收 1、5 |

### 2.3 反向：本 Epic 不向 `Colin4k1024/codex` 提任何 issue

本次不改 codex 仓库业务代码。若 D02 发现 app-server 协议存在阻断性缺口需要上游改动，**另开 issue 且需你单独授权**。

---

## 3. 跨仓库语义搜索（防止漏检）

```bash
gh search issues --repo Colin4k1024/vscode "" --limit 20
# → 空

gh search issues "agentHost codex" --owner Colin4k1024 --limit 20
# → 空

gh search issues "codex desktop" --owner Colin4k1024 --limit 20
# → 命中 6 条，全部在**其他仓库**，全部 CLOSED：
#   grok-build#160  ISS-085: 1:1 体验验收 — UXR walkthrough + 证据包（收口）
#   grok-build#105  ISS-057 [EPIC]: 桌面端交互重设计 — 与 Codex App Desktop 完全对齐
#   grok-build#128  ISS-069 [EPIC]: Codex 桌面端 1:1 复刻第二轮 — 真实化 + 质量基座 + 行为对齐
#   cangming#433    [P1][Native-Codex] 对齐宿主协议、动态工具与多模态扩展交付
#   cangming#480    [P1][Runtime][Mode] Code 模式完整切换 tRPC
#   cangming#405    [Epic] native Code 全面对齐 Codex Agent Harness 与 Plugins 扩展能力
```

### 3.1 命中项判定

| 命中 | 仓库 | 是否重复 | 判定 |
|---|---|---|---|
| `grok-build#105` ISS-057 [EPIC] 桌面端交互重设计 — 与 Codex App Desktop 完全对齐 | grok-build（自建 Electron+React app） | **不重复，但是关键先验资产** | 它已完成 Codex App Desktop 的**控件级交互基准调研**（三栏 / composer 内聚 / 无 tab / Projects→threads 树 / 右侧五 tab / 快捷键表）。→ **D07 直接以此为验收基准，不重新调研**。已写入 `00-FINDINGS.md` §7 与 D07 范围。 |
| `grok-build#128` ISS-069 [EPIC] Codex 桌面端 1:1 复刻第二轮 | grok-build | 不重复 | 同属自建 app 路线。D17 需实测复核其能力面。 |
| `grok-build#160` ISS-085 1:1 体验验收 | grok-build | 不重复 | UX 验收方法论可借鉴到 D07。 |
| `cangming#405/#433/#480` | cangming（Go，基于 openJiuwen 的 Agent） | 不重复 | 不同产品形态（IM 内的 Agent），非桌面 IDE。`#433` 的"对齐宿主协议、动态工具"与 D16 的 dynamic tools 评估有概念重叠，可在 D16 中引用其结论。 |

### 3.2 由此发现的两处**未在任何 issue 中登记**的先验资产

调研中额外发现（`gh repo list` + `gh api repos/.../contents`）：

| 仓库 | 内容 | 与本 Epic 的关系 |
|---|---|---|
| **`Colin4k1024/grok-code-product`** | "Code OSS thin distribution build system"，Shell。`VERSION`=0.1.0，`UPSTREAM_COMMIT`=`138f619c86f1199955d53b4166bef66ef252935c`。含 `scripts/{fetch-upstream,apply-patches,build,package,bundle-agent,generate-icons,generate-sbom,check-update,sync-upstream,verify-beta-gates}.sh`、`product/{product.json,branding,default-settings.json,extensions.json}`、`patches/`（Beta 上限 5）、`docs/{getting-started,enterprise}.md`。**0 issue、0 PR。** | **D06 / D09 / D10 / D14 应当移植而非重写。** 已修订四张 issue 的描述与验收标准。 |
| **`Colin4k1024/grok-code-extension`** | "Grok Code built-in VS Code extension — AI coding agent via ACP protocol"，TypeScript。**0 issue、0 PR。** | 本路线下不需要（agentHost 是原生 provider，不经扩展宿主，能力优于 ACP）。D17 需给出去留结论。 |

→ 这两处资产此前**没有 issue 跟踪**，是本 Epic 的 **D17（路线裁定与先验资产归并）** 存在的直接理由。D17 已作为 P0 前置插到 Wave 2，门禁 D06/D07/D09。

---

## 4. 与 microsoft/vscode 上游的关系（说明，非重复检查）

`Colin4k1024/vscode` 是 `microsoft/vscode` 的 fork，HEAD 与上游 main 同步（`fb20064c0f4`，165,607 commits）。
上游 issue tracker 里存在大量 `chat`/`agentHost`/`codex` 相关 issue，但：

- 本 Epic 的 17 张 issue **全部是自有产品化工作**（品牌、打包、去耦、认证默认值、自有验收矩阵），不是上游 bug
- 上游 issue 不应被复制过来；若 D11–D13 的验收发现真实上游 bug，应**在 upstream 提 issue 并附最小复现**，本地 issue 只做跟踪引用

→ 无需在 `microsoft/vscode` 做重复检查（也不应向其提交本 Epic 的 issue）。

---

## 5. 提交前 checklist（待你授权后执行）

- [ ] 你确认 `00-FINDINGS.md` §6 的目标 / 范围 / 非目标 / 约束
- [ ] 你确认 `00-FINDINGS.md` §7.2 的战略裁定（agentHost 为内核 + 移植 grok-code-product 流水线 + grok-build ISS-057 为 UX 基准）
- [ ] 你确认目标仓库为 `Colin4k1024/vscode`
- [ ] 创建 label：`codex-desktop` `P0` `P1` `P2` `area:agentHost` `area:packaging` `area:auth` `area:quality` `area:legal`
- [ ] 先创建 Epic（D00），拿到 issue 编号
- [ ] 按 D17 → D01 → D02 → … 顺序创建 16 张子 issue，每张 body 末尾填入 Epic 链接
- [ ] 每张涉及协议语义的 issue（D02/D05/D12/D13）body 中加入
      `Related: Colin4k1024/codex#1 #2 #3 #19 #20 #21`
- [ ] D06/D07/D09/D10/D14 的 body 中加入对 `grok-code-product` / `grok-build` 的先验资产引用
- [ ] 创建后回读一遍，确认 Epic 的 task list 链接全部可点

提交脚本草稿见 `submit.sh`（**未执行**）。
