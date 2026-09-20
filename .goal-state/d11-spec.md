# D11 实施规格（Issue #13）— 确定性 replay 验收矩阵扩展

Branch: codex-desktop/d11-replay-matrix（从 main 切出）
先读 issue 原文 `.goal-state/issues/13.md` 与
`src/vs/platform/agentHost/test/node/e2e/README.md`（权威治理说明）。

## 本批次范围（D03–D05 行为 capture 依赖那些 issue 合并，另行补录；本批次不做）
1. 摸清现有 103 个 capture 与 harness 三条运行模式（replay / UPDATE_AHP_SNAPSHOTS /
   UPDATE_SNAPSHOTS+REPLAY_RECORD），写一份缺口分析：跑
   `npm run test-agent-host-e2e-coverage`，把未覆盖分支列成表。
2. 补齐负向 capture：B1/B2/B7/B8/B16/B17/B18/B25/B28，每条至少 1 个
   （对照 `01-ACCEPTANCE-CORE.md` B 段原文；B 段与 D13 的单测互补，你负责 replay 层）。
3. 严格性断言（AC2/AC3）：未录制请求=硬失败；每条录制响应 teardown 前必须消费完。
   先审计 harness 是否已有此语义；有则写"故意违例→失败"的元测试，无则在 harness 补
   （harness 改动属允许范围，但需在交付说明标注）。
4. 隔离性断言（AC4）：export CODEX_HOME=/tmp/probe 后跑测试，断言未读写该路径
   （临时目录探针）。
5. live-only 清单（AC8）：mid-turn steering / late tool registration / truncate 等，
   每项写明为什么不能确定性重放，落 `.agents/research/codex-desktop/LIVE-ONLY.md`。
6. CI 门禁（AC9）：确认 replay 套件在 `.github/workflows/` 某 PR 必过 workflow 中；
   不在则加入 `codex-desktop-baseline.yml`。

## 硬约束
- 治理原则 1：测试只能通过 IAgentHostTarget + AHP 协议对话；禁止 import host 内部模块
  （除 IAgentHostTarget 与协议类型）。新增测试文件头部加注释声明此约束。
- 不改被测实现；不重录真实付费流量；不动 `../protocol/` 旧套件。
- 另一 worker（D13）也在 test 目录写负向单测，你的写范围限定在
  `test/node/e2e/**` 与上述文档/workflow，避开 `test/node/codex/*.test.ts`。
- commit 前缀 `codex-desktop: D11 ...`；不 push 不建 PR。

## 运行方式
依赖装好后：`npm run test-agent-host-e2e`（replay 模式，无 token 无网络必须全绿）。

## 交付回复
改动文件清单、B 段覆盖映射表、覆盖率报告摘要、live-only 清单路径、测试运行结果。
