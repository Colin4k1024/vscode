# 调研交付物索引

**任务**：只读调研 `/Users/jiafan/Desktop/poc/codex` 与 `/Users/jiafan/Desktop/poc/vscode`，形成"把 Codex 能力集成进 VS Code、做成自有 coding desktop app"的实施设计。

**日期**：2026-09-19　**调研方式**：只读，**未修改任何业务代码**（`git status` 只有 `?? .agents/research/`）。
**提交状态**：已获授权并于 2026-09-19 提交到 `Colin4k1024/vscode` —— **Epic #1 + 子 Issue #2–#18**。

---

## 文件

| 文件 | 内容 | 何时读 |
|---|---|---|
| **`00-FINDINGS.md`** | 当前事实（§1）、缺口 G1–G15（§2）、风险 R1–R12（§3）、关键依赖（§4）、Issue 去重结论（§5）、建议的目标/范围/非目标/约束（§6）、**先验资产盘点与战略裁定（§7）** | **先读这个**，特别是 §0 与 §7 |
| **`01-ACCEPTANCE-CORE.md`** | 核心验收逻辑：A 段状态机不变量（A1–A5，含编排层 I1–I8）、B 段负向场景（B1–B28）、C 段并发/崩溃/恢复（C1–C3）、D 段外部副作用检查（D1–D20）、E 段放行门 | 写测试或评审 PR 时 |
| **`02-ISSUES.md`** | 1 个 Epic（D00）+ 17 张子 Issue（D01–D17），每张含目标/范围/非目标/依赖/回滚/验收标准 | 拆分与排期 |
| **`03-DEDUP.md`** | 提交前重复 Issue 检查报告：目标仓库、相邻仓库、跨仓库语义搜索的完整证据与判定 | 提交前必读 |
| **`submit.sh`** | 创建 label + Epic + 17 张 issue 的脚本。**默认 DRY-RUN**，`--execute` 才真写。issue body 从 `02-ISSUES.md` 按标题切分提取，保证文件与 GitHub 一致 | 获得授权后 |

---

## 一句话结论

> **VS Code 这个 fork 里已经有一套完整、成熟、带 CI 门禁的 Codex 集成**
> （`src/vs/platform/agentHost/node/codex/`，26 文件 / ~15k LOC / 828 个 vendored 协议类型 /
> 103 个确定性 replay e2e capture / 190 次上游提交 / `AGENTS.md` 自述 COMPLETE 2026-07-01），
> 而且 `src/vs/sessions/` 已经是一个 agent-first 的独立窗口形态（`--agents`）。
>
> 所以真正的工作不是"集成 Codex"，而是 **启用 + 去 GitHub 耦合 + 品牌化 + 打包 + 验收加固**。

## 三个必须先做的决定

1. **D17 路线裁定**：你已有三条并行路线（本仓库 agentHost / `grok-build` 自建 Electron+ACP / `grok-code-product` 瘦发行）。
   推荐 **agentHost 为内核 + 移植 grok-code-product 流水线 + 以 grok-build ISS-057 为 UX 基准**。理由见 `00-FINDINGS.md` §7.2。
2. **认证形态**：`codexAccountState.ts` 当前把 **API Key 认证映射为 `unavailable`**（G4），默认 provider 是 Copilot 代理（G5），
   Agents 窗口默认撞 GitHub 登录墙（G6）。→ 决定你的 app 主打 ChatGPT 订阅还是 API Key（**D10 的 OpenAI ToS 裁定会反向约束这个决定**，R4）。
3. **Codex 版本策略**：pin 是 **0.153.0**，本机 codex 是 **0.155.1**，`/poc/codex` 是 main（G3）。→ D02 三选一。

## 三个硬阻断

- **G1**：仓库裸的（无 `node_modules`/`out`），且 Node **22.22.2** ≠ `.nvmrc` 要求的 **24.18.0**，`build/npm/preinstall.ts` 会硬失败 → **D01**
- **G2**：`product.json` 无 `agentSdks`，出厂构建里 Codex provider **不会注册**（`agentHostMain.ts:175`）→ **D02 + D09**
- **G13/R1**：合规裁定未做，不得对外分发 → **D10**（门禁 D09）

## 提交结果（已完成）

https://github.com/Colin4k1024/vscode/issues

| 编号 | Issue | 优先级 | labels | Wave |
|---|---|---|---|---|
| [#1](https://github.com/Colin4k1024/vscode/issues/1) | **D00 [Epic]** 自有品牌 Coding Desktop App | — | `codex-desktop` | — |
| [#2](https://github.com/Colin4k1024/vscode/issues/2) | D17 路线裁定与先验资产归并 | P0 | packaging | 2 |
| [#3](https://github.com/Colin4k1024/vscode/issues/3) | D01 构建与启动基线 | P0 | packaging | 1 |
| [#4](https://github.com/Colin4k1024/vscode/issues/4) | D02 Codex 二进制供给与协议版本锁 | P0 | agentHost, packaging | 2 |
| [#5](https://github.com/Colin4k1024/vscode/issues/5) | D03 OpenAI 原生认证一等化 | P0 | auth, agentHost | 3 |
| [#6](https://github.com/Colin4k1024/vscode/issues/6) | D04 解除 GitHub 强制耦合 | P0 | auth, agentHost | 3 |
| [#7](https://github.com/Colin4k1024/vscode/issues/7) | D05 默认 provider / 模型 / 权限策略 | P1 | agentHost | 4 |
| [#8](https://github.com/Colin4k1024/vscode/issues/8) | D06 产品身份与品牌 | P1 | packaging | 3 |
| [#9](https://github.com/Colin4k1024/vscode/issues/9) | D07 Agents 窗口作为默认桌面形态 | P2 | packaging | 4 |
| [#10](https://github.com/Colin4k1024/vscode/issues/10) | D08 Copilot 依赖与第三方遥测出口隔离 | P1 | packaging, legal | 3 |
| [#11](https://github.com/Colin4k1024/vscode/issues/11) | D09 本地打包流水线与自托管 SDK 分发 | P1 | packaging | 5 |
| [#12](https://github.com/Colin4k1024/vscode/issues/12) | D10 许可、商标与再分发合规裁定 | P1 | legal | 1 |
| [#13](https://github.com/Colin4k1024/vscode/issues/13) | D11 确定性 replay 验收矩阵扩展 | P0 | quality | 2 |
| [#14](https://github.com/Colin4k1024/vscode/issues/14) | D12 状态机不变量守卫 | P0 | quality, agentHost | 2 |
| [#15](https://github.com/Colin4k1024/vscode/issues/15) | D13 崩溃 / 并发 / 恢复 / 背压 负向验收 | P0 | quality, agentHost | 2 |
| [#16](https://github.com/Colin4k1024/vscode/issues/16) | D14 上游同步与版本升级 runbook + CI 门禁 | P2 | quality, packaging | 4 |
| [#17](https://github.com/Colin4k1024/vscode/issues/17) | D15 扩展市场与生态可用性 | P2 | packaging | 6 |
| [#18](https://github.com/Colin4k1024/vscode/issues/18) | D16 未接线 Codex 能力评估 | P2 | agentHost | 6 |

提交后校验：
- 17 张子 Issue 全部含「目标 / 范围 / 非目标 / 依赖 / 回滚 / 验收标准」六要素（脚本逐张 grep 校验，无缺失）
- 每张含 `Part of #1` 反向链接；Epic #1 的 task list 已换成真实 issue 链接（GitHub 自动追踪进度）+ 依赖矩阵
- #4 / #7 / #14 / #15 含 `Related: Colin4k1024/codex#1/#2/#3/#19/#20/#21`，复用已有协议语义结论
- #8 / #9 / #11 / #12 / #16 含 `grok-code-product` / `grok-build` 先验资产引用
- 新建 9 个 label：`codex-desktop` `P0` `P1` `P2` `area:agentHost` `area:packaging` `area:auth` `area:quality` `area:legal`

`submit.sh` 保留为幂等安全脚本：默认 DRY-RUN；`--execute` 时若检测到目标仓库已有 issue 会**拒绝自动创建**（防重复提交）。
后续若需重建，先人工清理或用 `gh issue edit` 就地更新。
