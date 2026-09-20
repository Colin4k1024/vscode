# D13 实施规格（Issue #15）— 崩溃/并发/恢复/背压 负向验收

Branch: codex-desktop/d13-negative-acceptance（从 main 切出）
先读 issue 原文 `.goal-state/issues/15.md` 与验收内核 `.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md`（B/C 段）。

## 性质
纯测试资产 + 必要的最小修复。验收标准 17 条全部要落到可执行断言。
被测代码：`src/vs/platform/agentHost/node/codex/codexAgent.ts`、`codexAppServerClient.ts`、
`codexPrewarmEviction.ts`、`codexThreadCoordination.ts`、`common/pendingRequestRegistry.ts` 等。
**不得改协议生成物**；发现实现 bug 时最小修复单独 commit 并在交付说明显著标注。

## 与其他 worker 的隔离
- 另一 worker（D12，分支 codex-desktop/d12-state-invariants）在写 A 段不变量测试，文件不同；
  若需新增共享测试 helper，放你自己的新文件里，命名带 d13 前缀，合并时编排者归并。
- 不得修改 `codexAgent.ts` 以外也不许改……更正：你可以最小修复实现 bug，但每个修复必须
  独立 commit 且 commit message 以 `codex-desktop: D13 fix ...` 开头。

## 运行方式
依赖装好后（/tmp/npm-ci2.log 看状态）：
`npm run gulp transpile-client-esbuild` → `npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"`。

## 重点排序（按 issue 标注）
AC1（A1.4/D16 进程清理）→ AC2（C2.4 uncertain）→ AC3（C2.1/B5 kill app-server）→
AC6（B8 背压）→ AC7（B7 连接替换）→ AC8（C1.10 proxy 所有权）→ AC9/AC10（并发合并）→
AC11（C3.11 数据安全）→ AC12（C3.9/C3.10 park 语义）→ AC13（C3.12 回滚杆）→ 其余。
每项落不了可执行断言的，在交付说明写明"为什么不可测/需要 live"，不许静默跳过。

## 交付
commit 前缀 `codex-desktop: D13 ...`；不 push 不建 PR。
最终回复：改动文件清单、AC→测试映射表、修复的 bug 清单、未覆盖项及理由。
