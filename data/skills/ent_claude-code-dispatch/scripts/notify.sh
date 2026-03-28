#!/bin/bash
# Claude Code Stop Hook: 任务完成后通过企业网关 IM API 通知用户
#
# 适配 Octopus 企业版：
#   - 通知通过 POST /api/_internal/im/send（飞书）
#   - 从 task-meta.json 读取 result_dir
#   - 去掉 Telegram / openclaw CLI / wake API

set -uo pipefail

# 从环境变量读取配置（在 Claude Code settings.json hook 的 environment 中设置）
GATEWAY_PORT="${OCTOPUS_GATEWAY_PORT:-18790}"
INTERNAL_TOKEN="${OCTOPUS_INTERNAL_TOKEN:-}"
NOTIFY_USER_ID="${OCTOPUS_USER_ID:-}"

# 默认结果目录（hook 会从 meta 文件覆盖）
RESULT_DIR="${OCTOPUS_RESULT_DIR:-}"

# 尝试从常见位置找 result_dir
find_result_dir() {
    local cwd="$1"
    # 从 cwd 向上找 claude-code-results
    local dir="$cwd"
    for _ in 1 2 3 4 5; do
        if [ -d "${dir}/claude-code-results" ]; then
            echo "${dir}/claude-code-results"
            return
        fi
        dir="$(dirname "$dir")"
    done
    # 最后 fallback
    echo "${cwd}/claude-code-results"
}

# 读 stdin（Claude Code hook 传入 JSON）
INPUT=""
if [ -t 0 ]; then
    : # stdin is tty, skip
elif [ -e /dev/stdin ]; then
    INPUT=$(timeout 2 cat /dev/stdin 2>/dev/null || true)
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null || echo "unknown")

# 确定 result_dir
if [ -z "$RESULT_DIR" ] && [ -n "$CWD" ]; then
    RESULT_DIR="$(find_result_dir "$CWD")"
fi
if [ -z "$RESULT_DIR" ]; then
    RESULT_DIR="/tmp/claude-code-results"
fi

mkdir -p "$RESULT_DIR"
LOG="${RESULT_DIR}/hook.log"

log() { echo "[$(date -Iseconds)] $*" >> "$LOG"; }

log "=== Hook fired: event=$EVENT session=$SESSION_ID cwd=$CWD ==="

# 防重复（30 秒去重窗口）
LOCK_FILE="${RESULT_DIR}/.hook-lock"
if [ -f "$LOCK_FILE" ]; then
    LOCK_TIME=$(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    AGE=$(( NOW - LOCK_TIME ))
    if [ "$AGE" -lt 30 ]; then
        log "Duplicate hook within ${AGE}s, skipping"
        exit 0
    fi
fi
touch "$LOCK_FILE"

# 等待 tee 管道 flush
sleep 1

# 读取 Claude Code 输出
OUTPUT=""
TASK_OUTPUT="${RESULT_DIR}/task-output.txt"
if [ -f "$TASK_OUTPUT" ] && [ -s "$TASK_OUTPUT" ]; then
    OUTPUT=$(tail -c 4000 "$TASK_OUTPUT")
    log "Output from task-output.txt (${#OUTPUT} chars)"
fi

# 读取任务元数据
META_FILE="${RESULT_DIR}/task-meta.json"
TASK_NAME="unknown"
DURATION=""
EXIT_CODE_VAL="0"

if [ -f "$META_FILE" ]; then
    META_AGE=$(( $(date +%s) - $(stat -c %Y "$META_FILE" 2>/dev/null || echo 0) ))
    if [ "$META_AGE" -gt 7200 ]; then
        log "Meta file is ${META_AGE}s old (>2h), ignoring stale meta"
    else
        TASK_NAME=$(jq -r '.task_name // "unknown"' "$META_FILE" 2>/dev/null || echo "unknown")
        EXIT_CODE_VAL=$(jq -r '.exit_code // 0' "$META_FILE" 2>/dev/null || echo "0")

        # 从 meta 读取 userId（如果环境变量未设置）
        if [ -z "$NOTIFY_USER_ID" ]; then
            NOTIFY_USER_ID=$(jq -r '.user_id // ""' "$META_FILE" 2>/dev/null || echo "")
        fi

        # 计算耗时
        STARTED=$(jq -r '.started_at // ""' "$META_FILE" 2>/dev/null || echo "")
        COMPLETED=$(jq -r '.completed_at // ""' "$META_FILE" 2>/dev/null || echo "")
        if [ -n "$STARTED" ] && [ -n "$COMPLETED" ]; then
            START_TS=$(date -d "$STARTED" +%s 2>/dev/null || echo 0)
            END_TS=$(date -d "$COMPLETED" +%s 2>/dev/null || echo 0)
            if [ "$START_TS" -gt 0 ] && [ "$END_TS" -gt 0 ]; then
                ELAPSED=$(( END_TS - START_TS ))
                MINS=$(( ELAPSED / 60 ))
                SECS=$(( ELAPSED % 60 ))
                DURATION="${MINS}m${SECS}s"
            fi
        fi

        log "Meta: task=$TASK_NAME exit=$EXIT_CODE_VAL user=$NOTIFY_USER_ID age=${META_AGE}s"
    fi
fi

# 写入结果 JSON
jq -n \
    --arg sid "$SESSION_ID" \
    --arg ts "$(date -Iseconds)" \
    --arg cwd "$CWD" \
    --arg event "$EVENT" \
    --arg output "$OUTPUT" \
    --arg task "$TASK_NAME" \
    '{session_id: $sid, timestamp: $ts, cwd: $cwd, event: $event, output: $output, task_name: $task, status: "done"}' \
    > "${RESULT_DIR}/latest.json" 2>/dev/null

log "Wrote latest.json"

# 通过企业网关 IM API 发送通知
if [ -z "$INTERNAL_TOKEN" ]; then
    log "No OCTOPUS_INTERNAL_TOKEN, skipping IM notification"
    exit 0
fi

if [ -z "$NOTIFY_USER_ID" ]; then
    log "No userId for notification, skipping"
    exit 0
fi

# 构建通知消息
STATUS="完成"
[ "$EXIT_CODE_VAL" != "0" ] && STATUS="失败 (exit $EXIT_CODE_VAL)"

MSG="Claude Code 任务${STATUS}\n\n任务: ${TASK_NAME}"
[ -n "$DURATION" ] && MSG="${MSG}\n耗时: ${DURATION}"

# 摘要（限 500 字符）
if [ -n "$OUTPUT" ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -c 500 | tr '\n' ' ')
    MSG="${MSG}\n\n摘要: ${SUMMARY}"
fi

# 发送通知
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "http://localhost:${GATEWAY_PORT}/api/_internal/im/send" \
    -H "Content-Type: application/json" \
    -H "x-internal-token: ${INTERNAL_TOKEN}" \
    -d "$(jq -n --arg userId "$NOTIFY_USER_ID" --arg message "$MSG" '{userId: $userId, message: $message}')" \
    2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    log "IM notification sent to $NOTIFY_USER_ID (HTTP $HTTP_CODE)"
else
    log "IM notification failed (HTTP $HTTP_CODE)"
fi

# 注入消息到 web 端 agent 会话，让 agent 读取结果并回复
INJECT_MSG="[Claude Code 任务完成通知] 任务「${TASK_NAME}」已${STATUS}。请读取 outputs/claude-code-results/latest.json 和 outputs/claude-code-results/task-output.txt 查看完整结果，向用户汇报。"

INJECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "http://localhost:${GATEWAY_PORT}/api/_internal/chat/inject" \
    -H "Content-Type: application/json" \
    -H "x-internal-token: ${INTERNAL_TOKEN}" \
    -d "$(jq -n --arg userId "$NOTIFY_USER_ID" --arg message "$INJECT_MSG" '{userId: $userId, message: $message}')" \
    2>/dev/null)

if [ "$INJECT_CODE" = "200" ]; then
    log "Chat inject sent to $NOTIFY_USER_ID (HTTP $INJECT_CODE)"
else
    log "Chat inject failed (HTTP $INJECT_CODE)"
fi

log "=== Hook completed ==="
exit 0
