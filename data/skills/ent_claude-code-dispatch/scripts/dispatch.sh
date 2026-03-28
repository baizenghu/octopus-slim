#!/bin/bash
# dispatch.sh — 派发任务到 Claude Code
#
# 适配 Octopus 企业版：
#   - 路径参数化（--workdir, --result-dir）
#   - 通知通过企业网关 IM API（notify.sh）
#   - claude 从 PATH 自动检测

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="${SCRIPT_DIR}/claude_code_run.py"

# Defaults
PROMPT=""
PROMPT_FILE=""
TASK_NAME="adhoc-$(date +%s)"
WORKDIR=""
RESULT_DIR=""
AGENT_TEAMS=""
AGENTS_JSON=""
TEAMMATE_MODE=""
PERMISSION_MODE="bypassPermissions"
ALLOWED_TOOLS=""
DISALLOWED_TOOLS=""
MODEL=""
FALLBACK_MODEL=""
MAX_BUDGET_USD=""
MAX_TURNS=""
WORKTREE=""
NO_SESSION_PERSISTENCE=""
APPEND_SYSTEM_PROMPT=""
APPEND_SYSTEM_PROMPT_FILE=""
MCP_CONFIG=""
VERBOSE=""
USER_ID=""

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--prompt) PROMPT="$2"; shift 2;;
        --prompt-file) PROMPT_FILE="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -w|--workdir) WORKDIR="$2"; shift 2;;
        --result-dir) RESULT_DIR="$2"; shift 2;;
        --user-id) USER_ID="$2"; shift 2;;
        --agent-teams) AGENT_TEAMS="1"; shift;;
        --agents-json) AGENTS_JSON="$2"; shift 2;;
        --teammate-mode) TEAMMATE_MODE="$2"; shift 2;;
        --permission-mode) PERMISSION_MODE="$2"; shift 2;;
        --allowed-tools) ALLOWED_TOOLS="$2"; shift 2;;
        --disallowed-tools) DISALLOWED_TOOLS="$2"; shift 2;;
        --model) MODEL="$2"; shift 2;;
        --fallback-model) FALLBACK_MODEL="$2"; shift 2;;
        --max-budget-usd) MAX_BUDGET_USD="$2"; shift 2;;
        --max-turns) MAX_TURNS="$2"; shift 2;;
        --worktree) WORKTREE="$2"; shift 2;;
        --no-session-persistence) NO_SESSION_PERSISTENCE="1"; shift;;
        --append-system-prompt) APPEND_SYSTEM_PROMPT="$2"; shift 2;;
        --append-system-prompt-file) APPEND_SYSTEM_PROMPT_FILE="$2"; shift 2;;
        --mcp-config) MCP_CONFIG="$2"; shift 2;;
        --verbose) VERBOSE="1"; shift;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

# Resolve prompt
if [ -n "$PROMPT_FILE" ]; then
    if [ ! -f "$PROMPT_FILE" ]; then
        echo "Error: prompt file not found: $PROMPT_FILE" >&2
        exit 1
    fi
    PROMPT="$(cat "$PROMPT_FILE")"
fi

if [ -z "$PROMPT" ]; then
    echo "Error: --prompt or --prompt-file is required" >&2
    exit 1
fi

# Defaults for paths
WORKDIR="${WORKDIR:-$(pwd)}"
RESULT_DIR="${RESULT_DIR:-${WORKDIR}/claude-code-results}"
mkdir -p "$RESULT_DIR"

META_FILE="${RESULT_DIR}/task-meta.json"
TASK_OUTPUT="${RESULT_DIR}/task-output.txt"

# Agent Teams: default testing agent
if [ -n "$AGENT_TEAMS" ] && [ -z "$AGENTS_JSON" ]; then
    AGENTS_JSON='{
  "testing-agent": {
    "description": "Dedicated testing agent. Use proactively to write and run tests for all code changes.",
    "prompt": "You are a Testing Agent. Your responsibilities:\n1. Write comprehensive unit tests for every module\n2. Run all tests and ensure they pass\n3. Check edge cases and error handling\n4. Report test results clearly\n5. If tests fail, communicate failures to the lead for fixes.\n\nAlways run tests after writing them. Never mark work as done until all tests pass.",
    "tools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
    "model": "sonnet"
  }
}'
    PROMPT="${PROMPT}

Note: A dedicated Testing Agent is available via --agents. Delegate test writing and execution to it. All tests must pass before the task is complete."
fi

# 1. Write task metadata
jq -n \
    --arg name "$TASK_NAME" \
    --arg prompt "$PROMPT" \
    --arg workdir "$WORKDIR" \
    --arg result_dir "$RESULT_DIR" \
    --arg user_id "$USER_ID" \
    --arg ts "$(date -Iseconds)" \
    --arg agent_teams "${AGENT_TEAMS:-0}" \
    --arg model "${MODEL:-}" \
    --arg fallback_model "${FALLBACK_MODEL:-}" \
    --arg max_budget "${MAX_BUDGET_USD:-}" \
    --arg max_turns "${MAX_TURNS:-}" \
    --arg worktree "${WORKTREE:-}" \
    '{task_name: $name, prompt: $prompt, workdir: $workdir, result_dir: $result_dir, user_id: $user_id, started_at: $ts, agent_teams: ($agent_teams == "1"), model: $model, fallback_model: $fallback_model, max_budget_usd: $max_budget, max_turns: $max_turns, worktree: $worktree, status: "running"}' \
    > "$META_FILE"

echo "Task metadata written: $META_FILE"
echo "  Task: $TASK_NAME"
echo "  Agent Teams: ${AGENT_TEAMS:-no}"
[ -n "$MAX_BUDGET_USD" ] && echo "  Budget: \$${MAX_BUDGET_USD}"
[ -n "$MAX_TURNS" ] && echo "  Max Turns: ${MAX_TURNS}"
[ -n "$MODEL" ] && echo "  Model: ${MODEL}"

# 2. Clear previous output
> "$TASK_OUTPUT"

# 3. Build runner command
PROMPT_TMPFILE="$(mktemp /tmp/dispatch-prompt-XXXXXX.txt)"
printf '%s' "$PROMPT" > "$PROMPT_TMPFILE"
trap 'rm -f "$PROMPT_TMPFILE"' EXIT

CMD=(python3 "$RUNNER" --prompt-file "$PROMPT_TMPFILE" --cwd "$WORKDIR")

[ -n "$AGENT_TEAMS" ] && CMD+=(--agent-teams)
[ -n "$AGENTS_JSON" ] && CMD+=(--agents-json "$AGENTS_JSON")
[ -n "$TEAMMATE_MODE" ] && CMD+=(--teammate-mode "$TEAMMATE_MODE")
[ -n "$PERMISSION_MODE" ] && CMD+=(--permission-mode "$PERMISSION_MODE")
[ -n "$ALLOWED_TOOLS" ] && CMD+=(--allowedTools "$ALLOWED_TOOLS")
[ -n "$DISALLOWED_TOOLS" ] && CMD+=(--disallowedTools "$DISALLOWED_TOOLS")
[ -n "$MODEL" ] && CMD+=(--model "$MODEL")
[ -n "$FALLBACK_MODEL" ] && CMD+=(--fallback-model "$FALLBACK_MODEL")
[ -n "$MAX_BUDGET_USD" ] && CMD+=(--max-budget-usd "$MAX_BUDGET_USD")
[ -n "$MAX_TURNS" ] && CMD+=(--max-turns "$MAX_TURNS")
[ -n "$WORKTREE" ] && CMD+=(--worktree "$WORKTREE")
[ -n "$NO_SESSION_PERSISTENCE" ] && CMD+=(--no-session-persistence)
[ -n "$APPEND_SYSTEM_PROMPT" ] && CMD+=(--append-system-prompt "$APPEND_SYSTEM_PROMPT")
[ -n "$APPEND_SYSTEM_PROMPT_FILE" ] && CMD+=(--append-system-prompt-file "$APPEND_SYSTEM_PROMPT_FILE")
[ -n "$MCP_CONFIG" ] && CMD+=(--mcp-config "$MCP_CONFIG")
[ -n "$VERBOSE" ] && CMD+=(--verbose)

# 4. Run Claude Code
echo "Launching Claude Code..."
echo "  Command: ${CMD[*]}"

"${CMD[@]}" 2>&1 | tee "$TASK_OUTPUT"
EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "Claude Code exited with code: $EXIT_CODE"

# Update meta with completion
if [ -f "$META_FILE" ]; then
    jq --arg code "$EXIT_CODE" --arg ts "$(date -Iseconds)" \
        '. + {exit_code: ($code | tonumber), completed_at: $ts, status: "done"}' \
        "$META_FILE" > "${META_FILE}.tmp" && mv "${META_FILE}.tmp" "$META_FILE"
fi

# 直接调用 notify（claude -p 模式不触发 Stop hook，需主动通知）
NOTIFY="${SCRIPT_DIR}/notify.sh"
if [ -x "$NOTIFY" ]; then
    echo '{"session_id":"dispatch","cwd":"'"$WORKDIR"'","hook_event_name":"dispatch_done"}' | \
        OCTOPUS_RESULT_DIR="$RESULT_DIR" \
        OCTOPUS_GATEWAY_PORT="${OCTOPUS_GATEWAY_PORT:-18790}" \
        OCTOPUS_INTERNAL_TOKEN="${OCTOPUS_INTERNAL_TOKEN:-}" \
        OCTOPUS_USER_ID="$USER_ID" \
        bash "$NOTIFY" || echo "Notify failed (non-fatal)"
fi

exit $EXIT_CODE
