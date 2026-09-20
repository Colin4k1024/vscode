# D08 实施规格（Issue #10）— Copilot 依赖与第三方遥测出口隔离

Branch: codex-desktop/d08-telemetry-isolation（从 main 切出）
先读 issue 原文 `.goal-state/issues/10.md`、`.agents/research/codex-desktop/LICENSE-CLEARANCE.md`（D10 结论）。

## 裁定（编排者已定，落实到决策记录 `.agents/research/codex-desktop/D08-DECISIONS.md`）
1. `extensions/copilot`：选 **(a) 保留但默认禁用**——(b)/(c) 的打包剥离涉及 compile-copilot
   工具链大改，首版不值；但必须在打包产物检查（D09 的 verify-beta-gates）留硬阻断钩子。
2. `product.json.defaultChatAgent`：移除 extensionId 指向 GitHub.copilot 的默认聊天代理配置
   与 aka.ms 链接（改为 undefined/删除字段；逐个核对下游消费者不崩）。
3. `builtInExtensions`（js-debug 等）：**保留**（MIT），但记录自托管镜像为后续跟进项。
4. `webviewContentExternalBaseUrlTemplate`：改本地打包（或删除字段用默认本地行为——
   先核对缺省行为），禁止 vscode-cdn.net 出现在出厂配置。
5. Copilot/Claude provider 默认注册：保留（可选通路），但断言无凭据时不发起网络连接。
6. `codexProxyService`：断言无 GitHub token 时不启动、不监听端口（unit）。
7. 遥测：`telemetry.telemetryLevel` 默认 off（产品级默认值）；断言 `codexTelemetryOverrides`
   的 `analytics.enabled=false`/`feedback.enabled=false` 不被覆盖（spawn args 断言，AC2/D2）。

## 工作项（对照 AC）
- AC1（D1 网络出口白名单）：写静态出口审计脚本 `scripts/audit-network-egress.sh`
  （扫描 product.json + 代码中的端点常量，对照白名单），动态 mitmproxy 实测列为
  PR 描述中的 manual verification 步骤。
- AC2/AC3（D2/D3/D4）：单测断言 spawn args 与 otel 默认值（找现有 telemetry 测试扩展）。
- AC4（D5）：凭据扫描脚本或测试（userDataDir/日志无明文 token）——与 D03 的 AC9 互补，
  聚焦遥测/配置落盘面。
- AC5：codexProxyService 无 token 不监听端口的 unit（可断言内部状态/lsof 留给 manual）。
- AC6/AC7：npm ci/compile 无 GitHub Packages 凭据可跑——审计 package.json 中
  @github/* 与 @vscode/copilot-api 的来源（npmjs 还是 GPR），若 GPR 依赖存在则这是
  裁定 (a) 的已知限制，写入 D08-DECISIONS.md。
- AC9：每项裁定落 D08-DECISIONS.md（D10 引用格式：D08-01 ... D08-07 编号）。

## 硬约束
- 不实现自有遥测后端；不删除 extensions/copilot 源码；不改 codexProxyService 实现。
- `product.json` 改动与 D06 worker 的 mixin 路线兼容：D06 保持上游 product.json 0 改动，
  你的 product.json 修改直接改上游文件——**冲突警示**：D06 分支不动 product.json，
  你可以动，但交付说明须列出改动行供编排者协调（可能需要把 product.json 改动迁到
  D06 的 mixin 层，编排者决定）。
- commit 前缀 `codex-desktop: D08 ...`；不 push 不建 PR。

## 交付回复
文件清单、裁定记录路径、AC→落点映射、测试/脚本运行结果、product.json 改动行清单、偏离说明。
