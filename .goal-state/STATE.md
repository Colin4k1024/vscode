# Goal State — 关闭 Colin4k1024/vscode 全部 open issue
Updated: 2026-09-21T10:15+08:00
Base branch: main (HEAD 69d35b2db83b，本轮已 fast-forward 同步)

## 总览
- 会话开始时的实际 open 数: **2**（#1 Epic、#66 D09 post-merge audit）——此前会话已关闭 D01–D16 全部子任务（D15 #17 已于 69d35b2db83b 合入）
- 剩余: #66（PR #70 审查通过，打包实证中）→ #1（Epic，最后关闭）

## 当前执行
| Issue | 状态 | 分支/PR | 测试 | 审查 |
|---|---|---|---|---|
| #66 D09 audit | PR_OPEN，审查 APPROVE | codex-desktop/issue66-d09-audit-fixes / PR #70 | 35 build + 6700 node 全绿；beta gates 全绿 | Pascal 两轮，round-2 APPROVE |
| #1 D00 Epic | 待 #66 关闭后收口 | - | - | - |

## #66 修复清单（H1 + M1–M3/M5–M8 + L1–L11）
- H1 per-target sha256：product.ts/common.ts/produce.ts/downloader/bundle/package 全链路；mergeAgentSdkResults 合并共享 results.json
- M1 asar 感知门禁（实证双向）；M2 gate 2c 静态引用硬门禁；M3 chatSetupHidden + 已知限制声明
- M5 tarball 卫生；M6 发布前哈希比对（实证正负路径）；M7 REH 任务体内 fail-loud（round-1 审查修复：load-time throw 会杀死桌面打包）；M8 UPSTREAM-SYNC 补录 16 行
- L1 白名单实证收紧（out/** 全名豁免限定 main/extensionHost 包、shell-integration 头、nls 表）；L2–L11 全部落地

## 验证
- `node --test build/agent-sdk/test/*.test.ts`: 35 pass
- `npm run test-node -- --runGlob "vs/platform/agentHost/test/node/**/*.test.js"`: 6700 passing
- `verify-beta-gates.sh --app`（真实 darwin-arm64 产物）: ALL BETA GATES PASSED
- 全量 `package.sh`（本分支源码）实证: 进行中（/tmp/package-run.log）

## 环境备注
- 仓库 GitHub Actions 当前 disabled（actions/permissions enabled=false）→ CI 不跑，本地实证替代
- git origin 已切 HTTPS（SSH 22 端口不通）；node 须用 node@24
- vscode-d14/、vscode-i24/ 为既有内嵌仓库目录，勿提交
