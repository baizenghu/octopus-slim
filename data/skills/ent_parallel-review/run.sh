#!/usr/bin/env bash
# data/skills/ent_parallel-review/run.sh
# 接收 $INPUT 为审查目标（文件列表或 diff）
# 并行启动 4 个审查子任务，等待全部完成后汇总

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${1:-${INPUT:-}}"

if [[ -z "$INPUT" ]]; then
  echo "用法: parallel-review <文件路径|diff内容>"
  echo ""
  echo "示例:"
  echo "  parallel-review apps/server/src/routes/auth.ts"
  echo "  parallel-review 'diff --git a/...'"
  exit 1
fi

echo "=== 并行代码审查开始 ==="
echo "审查目标: $INPUT"
echo ""

# 临时目录存放各 Agent 结果
TMPDIR_RESULTS=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RESULTS"' EXIT

# 读取各 Agent 提示模板并执行分析
declare -A AGENT_LABELS=(
  ["agent-a"]="A (业务逻辑)"
  ["agent-b"]="B (代码质量)"
  ["agent-c"]="C (稳定性)"
  ["agent-d"]="D (安全)"
)

# 并行执行各 Agent 分析
PIDS=()
for agent_key in "agent-a" "agent-b" "agent-c" "agent-d"; do
  agent_file="$SKILL_DIR/agents/${agent_key}.md"
  result_file="$TMPDIR_RESULTS/${agent_key}.txt"
  label="${AGENT_LABELS[$agent_key]}"

  (
    echo "--- Agent $label ---"
    if [[ -f "$agent_file" ]]; then
      echo "[审查维度]"
      head -20 "$agent_file"
    fi
    echo ""
    echo "[审查目标] $INPUT"
    echo "[状态] 待 Agent 运行时分析"
    echo ""
  ) > "$result_file" 2>&1 &
  PIDS+=($!)
done

# 等待所有子任务完成
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

echo ""
echo "=== 各 Agent 分析摘要 ==="
for agent_key in "agent-a" "agent-b" "agent-c" "agent-d"; do
  result_file="$TMPDIR_RESULTS/${agent_key}.txt"
  label="${AGENT_LABELS[$agent_key]}"
  echo ""
  echo "【Agent $label】"
  cat "$result_file"
done

echo ""
echo "=== 审查完成 ==="
echo "提示: 在完整 Agent 编排环境下，以上 4 个 Agent 将并行运行并输出详细问题列表（[X-NNN] 格式）"
