# D12 实施规格（Issue #14）— 状态机不变量守卫

Branch: codex-desktop/d12-state-invariants（从 main 切出，**不要**基于 d03 分支）

## 任务
把 `.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md` A 段（A1–A5 + I1–I8）变成可执行断言。
先读 issue 原文 `.goal-state/issues/14.md` 与验收内核文档。

## 已知事实（编排者核实）
- 被测对象：`src/vs/platform/agentHost/node/codex/codexMapAppServerEvents.ts`
  （`createCodexSessionMapState`/`finalizeCodexTurnMapState`/`mapTurnStarted`/`mapTurnCompleted`/
  `mapItemStarted`/`mapItemCompleted`）、`src/vs/platform/agentHost/common/pendingRequestRegistry.ts`、
  `src/vs/platform/agentHost/node/codex/codexAgent.ts`。
- e2e capture 资产：`src/vs/platform/agentHost/test/node/e2e/captures/codex-*.yaml`（103 个），
  README 在同目录，是权威说明；两条治理原则必须守住（测试外在于实现；只经 IAgentHostTarget/AHP 对话）。
- 既有测试目录：`src/vs/platform/agentHost/test/node/codex/`（如 codexMapAppServerEvents.test.ts）。
- **I8 已知技术债**：`node/codex/**` 目前 import 了 AgentHostStateManager（AGENTS.md §8 自述）。
  必须登记为 baseline 允许列表，只对新违规失败，不得直接红。
- 单测运行：`npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"`
  （需先 `npm run gulp transpile-client-esbuild`；依赖安装状态见 /tmp/npm-ci.log）。

## 交付物
1. **A1**：turn 生命周期转移表穷举单测（合法转移全过、非法转移全部拒绝/归一）。
2. **A2**：item started/completed 配对扫描器——新测试文件遍历全部 capture（用 replay mapper 解析，
   不走网络），断言配对；`mapItemCompleted` 后同 id `mapItemStarted` 状态不回退的单测。
3. **A3**：pendingRequestRegistry 断言（turn 终态后 pending 为空）跑遍全部 codex capture；
   fail-open 禁止负向单测（mock client 不响应审批 → 无 item/completed、无副作用、无终态）；
   畸形 decision 归一为 decline 的穷举；`resolveCodexPermissions`/`narrowAdditionalDirectories` 穷举；
   `isBlocking:true` 不读 `autoResolutionMs` 的断言。
4. **A4/I1–I8**：I1/I4/I6/I8 用 AST 或轻量静态扫描（放在 `src/vs/platform/agentHost/test/node/` 下，
   用 TypeScript compiler API 或正则+baseline 文件均可，但 I8 必须 baseline+新增即败）；
   I2 往返 + property-based URI 测试；I3/I5/I7 对应 unit/replay 断言。
5. **A5**：A5.3–A5.6、A5.8、A5.9 各至少一个 unit/replay 断言。
6. **双向追溯表**：`01-ACCEPTANCE-CORE.md` A 段每一行 → 测试位置，写成
   `.agents/research/codex-desktop/A-TRACEABILITY.md`。
7. CI 门禁：在 `.github/workflows/codex-desktop-baseline.yml` 的 agent-host 单测 job 已覆盖
   （新测试在同 glob 下即自动纳入）；若新增独立脚本（如 AST 扫描器），加入该 workflow。

## 硬约束
- 纯测试/静态检查资产：不改 `src/vs/platform/agentHost/node/**` 与 `common/**` 的实现源码
  （发现 bug 记录在交付说明，不修复）。不改 protocol/generated。
- 不修复 I8 技术债，只登记 baseline。
- commit 前缀 `codex-desktop: D12 ...`，原子提交；**不 push、不建 PR**。
- 若 npm 依赖未就绪无法跑测试，完成全部代码并在交付说明注明。

## 最终回复须包含
改动文件清单、每条 A/I 编号的落点（file）、测试运行结果、发现的实现 bug 清单（如有）、偏离规格说明。
