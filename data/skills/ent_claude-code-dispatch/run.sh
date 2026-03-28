#!/bin/bash
# 入口脚本：nohup 启动 dispatch 后立即返回
# run_skill 调用此脚本，避免阻塞等待 Claude Code 执行完毕

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISPATCH="${SCRIPT_DIR}/scripts/dispatch.sh"

# 工作目录：run_skill 的 cwd 是用户 workspace
WORKSPACE="$(pwd)"

# 从 workspace 路径提取 userId
# 路径格式：data/users/{userId}/workspace 或 data/users/{userId}/agents/{name}/workspace
USER_ID=""
if [[ "$WORKSPACE" =~ /users/(user-[^/]+)/ ]]; then
    USER_ID="${BASH_REMATCH[1]}"
fi

# 结果目录（outputs/ 是 run_skill 约定的输出目录）
RESULT_DIR="${WORKSPACE}/outputs/claude-code-results"
mkdir -p "$RESULT_DIR"

LOG_FILE="${RESULT_DIR}/dispatch-$(date +%s).log"

# 恢复 HOME 为真实用户目录（run_skill 会将 HOME 设为 workspace，导致 claude CLI 找不到认证）
REAL_HOME=$(getent passwd "$(whoami)" | cut -d: -f6)
export HOME="${REAL_HOME:-/home/baizh}"

# 企业网关 IM 通知配置（传递给 notify.sh）
export OCTOPUS_GATEWAY_PORT="${OCTOPUS_GATEWAY_PORT:-18790}"
export OCTOPUS_INTERNAL_TOKEN="${OCTOPUS_INTERNAL_TOKEN:-ent-internal-ec1f1bacced884859fa3e1c6}"
export OCTOPUS_USER_ID="$USER_ID"

# 后台启动 dispatch，传入 workspace、userId 和所有参数
nohup bash "$DISPATCH" \
  --workdir "$WORKSPACE" \
  --result-dir "$RESULT_DIR" \
  --user-id "$USER_ID" \
  "$@" \
  > "$LOG_FILE" 2>&1 &

DISPATCH_PID=$!

echo "Claude Code 任务已派发！"
echo "  PID: $DISPATCH_PID"
echo "  日志: $LOG_FILE"
echo "  结果: ${RESULT_DIR}/latest.json"
echo "  完成后将通过飞书自动通知。"
