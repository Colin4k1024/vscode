# D06 实施规格（Issue #8）— 产品身份与品牌

Branch: codex-desktop/d06-product-branding（从 main 切出）
先读 issue 原文 `.goal-state/issues/8.md`、`.agents/research/codex-desktop/ROUTE-DECISION.md` §4 与 D17 输入。

## 品牌定案（编排者裁定——占位代号，mixin 化保证可一行改名）
- nameShort: `ColinCode` / nameLong: `Colin Code` / applicationName: `colincode`
- dataFolderName: `.colincode` / sharedDataFolderName: `colincode`
- darwinBundleIdentifier: `com.colin4k1024.colincode` / urlProtocol: `colincode`
- win32 系列字段按同模式派生（RegValueName/Mutex/AppId 用全新 GUID——生成新的，勿复用上游）
- **PR 描述必须显式标注**：品牌为工作代号，最终定名 = 改 mixin 单文件。

## 架构裁定（按 issue 的 mixin 要求 + D17 裁定）
1. 新建 `product/` 目录（对齐 grok-code-product 布局）：`product/product.json`（覆盖层）、
   `product/branding/{darwin,win32,linux,app}/`、`product/default-settings.json`、
   `product/extensions.json`。上游 `product.json` **保持 0 改动**（AC9）。
2. 移植 `apply-mixin` 逻辑（源自 grok-code-product apply-patches.sh 的 mixin 半段）：
   应用 product.json 覆盖 + default-settings + branding 拷贝；**失败必须硬失败**
   （原脚本 git apply 静默跳过是已知缺陷，不得继承）。落 `scripts/apply-mixin.sh`。
3. 移植 `generate-icons.sh` 到 `scripts/generate-icons.sh`，输出名改为 colincode；
   需要品牌 SVG 源——用占位 logo（简单几何自绘 SVG，放 `product/branding/`）。
4. **R12 守卫**：不设置 `quality: 'stable'`；在 mixin 的 default-settings.json 显式写
   `chat.agentHost.codexAgent.enabled: true` 与 `chat.editor.codex.preferAgentHost: true`，
   并写静态断言脚本（或测试）验证有效默认值为 true。
5. `CLIENT_INFO.name`（codexAgent.ts 的 `vscode_agent_host`）→ `colincode_agent_host`。
   **注意**：codexAgent.ts 正被 D03 worker 修改——该文件的这处单行改动由编排者在合并时应用，
   你在交付说明给出精确 patch（old/new 行）。
6. urlProtocol 连带：核对 `src/vs/platform/agentHost/common/openSessionLink.ts` 的解析
   走 productService.urlProtocol（应为参数化），跑/补 openSessionLink 测试。

## 验收映射
- AC1/AC7：dev 启动或打包后验证（本机可跑 dev 启动脚本截图/日志断言）。
- AC2/AC3：dataFolderName 独立 + 与 VS Code 共存的静态断言（字段不与上游冲突）。
- AC5：R12 断言脚本 + 说明。
- AC8：打包产物字符串扫描脚本（白名单化第三方许可文本）落 `scripts/check-branding-residue.sh`。
- AC9：`git diff --stat product.json` == 0 的 CI 或脚本断言。
- AC10：`product/` 布局与 grok-code-product 对齐说明（若该仓库不可访问，按 ROUTE-DECISION §4 描述对齐）。

## 硬约束
- 不做签名/公证/自动更新；不移除 Copilot 内容（D08）。
- commit 前缀 `codex-desktop: D06 ...`；不 push 不建 PR。
- 依赖状态 /tmp/npm-ci2.log。

## 交付回复
文件清单、AC→落点映射、codexAgent.ts 的 CLIENT_INFO patch 建议、验证证据、偏离说明。
