#!/usr/bin/env bash
# 创建 Epic + 17 张 Issue 到 Colin4k1024/vscode
#
# ⚠️ 默认 DRY-RUN，只打印将要做的事，不发任何写请求。
#    确认无误后加 --execute 才会真正创建。
#
# 用法：
#   ./submit.sh              # dry-run
#   ./submit.sh --execute    # 真实创建（需你显式授权）
#
# 前置：
#   - gh 已认证且对 Colin4k1024/vscode 有 repo 权限
#   - 已阅读并确认 00-FINDINGS.md §6 / §7.2 与 03-DEDUP.md
#
# 本脚本不做任何删除操作。

set -euo pipefail

REPO="Colin4k1024/vscode"
CODEX_REPO="Colin4k1024/codex"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISSUES_MD="$DIR/02-ISSUES.md"

EXECUTE=0
[[ "${1:-}" == "--execute" ]] && EXECUTE=1

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

run() {
  if [[ $EXECUTE -eq 1 ]]; then
    "$@"
  else
    log "DRY-RUN: $*"
  fi
}

# ---------------------------------------------------------------- 前置检查

command -v gh >/dev/null || { echo "需要 gh CLI"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh 未认证"; exit 1; }
[[ -f "$ISSUES_MD" ]] || { echo "缺少 $ISSUES_MD"; exit 1; }

log "目标仓库：$REPO"
log "模式：$([[ $EXECUTE -eq 1 ]] && echo EXECUTE || echo DRY-RUN)"

EXISTING=$(gh issue list -R "$REPO" --state all --limit 200 --json number,title -q '.[] | "\(.number) \(.title)"' 2>/dev/null || true)
if [[ -n "$EXISTING" ]]; then
  log "⚠️ 目标仓库已存在 issue，请先人工确认是否重复："
  echo "$EXISTING" >&2
  if [[ $EXECUTE -eq 1 ]]; then
    echo "为安全起见，检测到已有 issue 时拒绝自动创建。请人工核对后再运行。" >&2
    exit 1
  fi
else
  log "目标仓库无 issue，重复检查通过（详见 03-DEDUP.md）"
fi

# ---------------------------------------------------------------- label

# 注意：macOS 自带 bash 3.2 不支持关联数组，这里用 "name:color:desc" 字符串列表。
# 颜色不带 '#'，避免 shell 与 gh 的转义歧义。
LABELS=(
  "codex-desktop|5319E7|Codex Desktop App Epic 与子任务"
  "P0|B60205|阻断 MVP 放行"
  "P1|D93F0B|发布门 / 核心体验"
  "P2|FBCA04|后续增强"
  "area:agentHost|1D76DB|src/vs/platform/agentHost"
  "area:packaging|0E8A16|构建、打包、分发、品牌"
  "area:auth|D93F0B|认证与账号"
  "area:quality|5319E7|测试、验收、CI 门禁"
  "area:legal|000000|许可、商标、合规"
)

for entry in "${LABELS[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  color="${rest%%|*}"
  desc="${rest#*|}"
  run gh label create "$name" -R "$REPO" --color "$color" --description "$desc" --force
done

# ---------------------------------------------------------------- Epic

EPIC_TITLE="D00 [Epic] 基于 VS Code 1.139 + Codex app-server 的自有品牌 Coding Desktop App"

read -r -d '' EPIC_BODY <<EOF || true
## 背景

调研结论（\`.agents/research/codex-desktop/00-FINDINGS.md\`）：**Codex 集成已存在于本仓库**——
\`src/vs/platform/agentHost/node/codex/\`（26 文件 / ~15k LOC）、828 个 vendored 协议类型、
103 个确定性 replay e2e capture、\`AGENTS.md\` 自述 Status: COMPLETE (2026-07-01)、190 次上游提交。
同时 \`src/vs/sessions/\` 已是一个 agent-first 的独立窗口形态（\`--agents\`）。

因此本 Epic **不是**"从零集成 Codex"，而是五条工作线：

0. **先裁定**（D17）：三条并行路线的取舍与先验资产归并 —— 门禁 D06/D07/D09
1. **可运行**（D01–D02）：仓库 bootstrap + Codex 二进制的出厂供给与版本锁
2. **可独立**（D03–D05）：OpenAI 原生认证一等化，解除 GitHub/Copilot 强制耦合
3. **可发布**（D06、D08–D10、D15）：品牌、遥测隔离、打包、合规、扩展生态
4. **可信任**（D11–D14、D16）：验收矩阵、不变量守卫、负向/并发/崩溃、上游同步、能力评估

## 代码基线

| 仓库 | HEAD | 说明 |
|---|---|---|
| \`Colin4k1024/vscode\` | \`fb20064c0f4\` | code-oss-dev 1.139.0，跟踪 microsoft/vscode main |
| \`Colin4k1024/codex\` | \`ac192cd79\` | Codex 协议 pin 0.153.0（\`build/codex/codex-version.txt\`） |

## 先验资产（\`00-FINDINGS.md\` §7）

- \`grok-code-product\` — Code OSS 瘦发行构建系统（10 个成熟脚本）→ **D06/D09/D10/D14 移植而非重写**
- \`grok-build\` ISS-057 — Codex App Desktop 控件级交互基准 → **D07 直接以此为验收基准**
- \`grok-code-extension\` — ACP 内置扩展 → 本路线下不需要，D17 给出去留结论
- \`Colin4k1024/codex#1–#29\` — harness 工作流运行时（**不同项目**）→ D02/D05/D12/D13 交叉引用其协议语义结论

## 依赖顺序

\`\`\`
Wave 1  D01 ─────────────────────────────┐
        D10 (合规裁定，可并行，门禁发布)      │
                                          ▼
Wave 2  D02 (D01)              D11 D12 D13 (D01+D02)
        D17 (D01，门禁 D06/D07/D09)
                                          │
Wave 3  D03 D04 (D02)          D06 D08 (D01+D17)
                                          │
Wave 4  D05 (D03+D04)          D07 (D04+D17)   D14 (D02+D11)
                                          │
Wave 5  D09 (D02+D06+D08+D17，被 D10 门禁)
                                          │
Wave 6  D15 (D09)              D16 (D03+D05)
\`\`\`

## 放行门

- **MVP 门（内部可用）**：D01 D02 D03 D04 D05 D11 D12 D13 全绿
  → 零 GitHub 登录、仅 OpenAI 凭据（ChatGPT 或 API Key）完成完整闭环
- **发布门（可对外分发）**：追加 D06 D08 D09 D10 D15
- **非阻断**：D07 D14 D16

## 验收内核

全部子 issue 的验收标准引用 \`.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md\`：
A 段状态机不变量（A1–A5，含编排层 I1–I8）、B 段负向场景（B1–B28）、
C 段并发/崩溃/恢复（C1–C3）、D 段外部副作用检查（D1–D20）。

## 明确不做

- 不重写已有的 \`agentHost/node/codex/\` 集成
- 不改 \`Colin4k1024/codex\` 的 Rust 业务代码
- 不做 Codex 侧的 harness 工作流运行时（那是 codex#1–#29）
- 不做自动更新服务 / 增量差分更新
- 不做 Web 版 / 服务端多租户 / 远程 agent host 集群
- 不接语音 realtime / cloud tasks / Apps UI / memories / code-mode / attestation（D16 仅评估）
- 不自建扩展市场服务端

## Task list

- [ ] D17 路线裁定与先验资产归并（**P0 前置**）
- [ ] D01 构建与启动基线
- [ ] D02 Codex 二进制供给与协议版本锁
- [ ] D03 OpenAI 原生认证一等化
- [ ] D04 解除 GitHub 强制耦合
- [ ] D05 默认 provider / 模型 / 权限策略
- [ ] D06 产品身份与品牌
- [ ] D07 Agents 窗口作为默认桌面形态
- [ ] D08 Copilot 依赖与第三方遥测出口隔离
- [ ] D09 本地打包流水线与自托管 SDK 分发
- [ ] D10 许可、商标与再分发合规裁定
- [ ] D11 确定性 replay 验收矩阵扩展
- [ ] D12 状态机不变量守卫
- [ ] D13 崩溃 / 并发 / 恢复 / 背压 负向验收
- [ ] D14 上游同步与版本升级 runbook + CI 门禁
- [ ] D15 扩展市场与生态可用性
- [ ] D16 未接线 Codex 能力评估
EOF

if [[ $EXECUTE -eq 1 ]]; then
  EPIC_URL=$(gh issue create -R "$REPO" \
    --title "$EPIC_TITLE" \
    --label "codex-desktop" \
    --body "$EPIC_BODY")
  EPIC_NUM="${EPIC_URL##*/}"
  log "Epic 已创建：#$EPIC_NUM  $EPIC_URL"
else
  EPIC_NUM="<EPIC>"
  log "DRY-RUN: 将创建 Epic [${EPIC_TITLE}]"
fi

# ---------------------------------------------------------------- 子 Issue
#
# 每张 issue 的 body 从 02-ISSUES.md 中按 "## Dxx " 标题切分提取，
# 保证「文件里的」与「GitHub 上的」完全一致，不手写第二份。

extract_issue() {
  local id="$1"
  awk -v id="## $id " '
    index($0, id) == 1 { found=1; next }
    found && /^## D[0-9]/ { exit }
    found && /^---$/ { next }
    found { print }
  ' "$ISSUES_MD" | sed -e 's/^[[:space:]]*$//' | awk 'NF{p=1} p'
}

# id|title|labels
ISSUES=(
  "D17|D17 [P0] 路线裁定与先验资产归并|codex-desktop,P0,area:packaging"
  "D01|D01 [P0] 构建与启动基线|codex-desktop,P0,area:packaging"
  "D02|D02 [P0] Codex 二进制供给与协议版本锁|codex-desktop,P0,area:agentHost,area:packaging"
  "D03|D03 [P0] OpenAI 原生认证一等化|codex-desktop,P0,area:auth,area:agentHost"
  "D04|D04 [P0] 解除 GitHub 强制耦合|codex-desktop,P0,area:auth,area:agentHost"
  "D05|D05 [P1] 默认 provider / 模型 / 权限策略|codex-desktop,P1,area:agentHost"
  "D06|D06 [P1] 产品身份与品牌|codex-desktop,P1,area:packaging"
  "D07|D07 [P2] Agents 窗口作为默认桌面形态|codex-desktop,P2,area:packaging"
  "D08|D08 [P1] Copilot 依赖与第三方遥测出口隔离|codex-desktop,P1,area:packaging,area:legal"
  "D09|D09 [P1] 本地打包流水线与自托管 SDK 分发|codex-desktop,P1,area:packaging"
  "D10|D10 [P1] 许可、商标与再分发合规裁定|codex-desktop,P1,area:legal"
  "D11|D11 [P0] 确定性 replay 验收矩阵扩展|codex-desktop,P0,area:quality"
  "D12|D12 [P0] 状态机不变量守卫|codex-desktop,P0,area:quality,area:agentHost"
  "D13|D13 [P0] 崩溃 / 并发 / 恢复 / 背压 负向验收|codex-desktop,P0,area:quality,area:agentHost"
  "D14|D14 [P2] 上游同步与版本升级 runbook + CI 门禁|codex-desktop,P2,area:quality,area:packaging"
  "D15|D15 [P2] 扩展市场与生态可用性|codex-desktop,P2,area:packaging"
  "D16|D16 [P2] 未接线 Codex 能力评估|codex-desktop,P2,area:agentHost"
)

# 涉及 app-server 协议语义的 issue，交叉引用 codex 仓库已有结论（见 03-DEDUP.md §2.2）
related_codex_issues() {
  case "$1" in
    D02) echo "Colin4k1024/codex#1" ;;
    D05) echo "Colin4k1024/codex#2" ;;
    D12) echo "Colin4k1024/codex#1 Colin4k1024/codex#3 Colin4k1024/codex#20" ;;
    D13) echo "Colin4k1024/codex#2 Colin4k1024/codex#3 Colin4k1024/codex#19 Colin4k1024/codex#20 Colin4k1024/codex#21" ;;
    *)   echo "" ;;
  esac
}

for entry in "${ISSUES[@]}"; do
  IFS='|' read -r id title labels <<< "$entry"

  body=$(extract_issue "$id")
  if [[ -z "$body" ]]; then
    echo "无法从 $ISSUES_MD 提取 $id 的 body，跳过" >&2
    continue
  fi

  # 用 printf 拼接，避开 bash 3.2 在 $'...' 与多字节字符相邻时的解析问题
  footer=$(printf '\n\n---\n\nPart of #%s。\n调研依据：`.agents/research/codex-desktop/00-FINDINGS.md`；验收内核：`01-ACCEPTANCE-CORE.md`。' "$EPIC_NUM")
  rel=$(related_codex_issues "$id")
  if [[ -n "$rel" ]]; then
    footer="${footer}$(printf '\n\nRelated（app-server 协议语义已有结论，直接复用，勿重复推导）：%s' "$rel")"
  fi
  body="${body}${footer}"

  if [[ $EXECUTE -eq 1 ]]; then
    url=$(gh issue create -R "$REPO" --title "$title" --label "$labels" --body "$body")
    log "已创建 ${url##*/}  $title"
  else
    lines=$(printf '%s' "$body" | wc -l | tr -d ' ')
    log "DRY-RUN: 将创建 [${title}] labels=[${labels}] body=${lines} 行"
  fi
done

log "完成。$([[ $EXECUTE -eq 1 ]] && echo "已创建 1 Epic + ${#ISSUES[@]} 张 issue" || echo "DRY-RUN 未发出任何写请求")"
