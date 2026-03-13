#!/bin/bash
# ============================================================
# Octopus Enterprise 自动化测试脚本
# ============================================================
# 用法: ./run_tests.sh [模块名] [--verbose]
# 模块: auth, chat, agents, admin, audit, files, skills, mcp,
#       scheduler, quotas, env, db-conn, health, security, all
# 示例:
#   ./run_tests.sh all          # 运行所有测试
#   ./run_tests.sh auth         # 只测认证模块
#   ./run_tests.sh security     # 只测安全模块
#   ./run_tests.sh auth --verbose  # 认证模块 + 详细输出
# ============================================================

set -o pipefail

# ─── 配置 ─────────────────────────────────────────────
BASE_URL="http://localhost:18790"
USERNAME="admin"
PASSWORD="password123"
REPORT_FILE="$(cd "$(dirname "$0")" && pwd)/report.txt"
VERBOSE=0
MODULE="all"

# ─── 颜色 ─────────────────────────────────────────────
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── 计数器 ───────────────────────────────────────────
TOTAL=0
PASS=0
FAIL=0
SKIP=0

# ─── 临时数据追踪（清理用） ──────────────────────────
TEMP_AGENT_ID=""
TEMP_USER_ID=""
TEMP_SCHEDULER_ID=""
TEMP_FILE_NAME=""
TEMP_DB_CONN_ID=""

# ─── 报告缓冲 ────────────────────────────────────────
REPORT_LINES=()

# ─── 参数解析 ─────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --verbose|-v) VERBOSE=1 ;;
        *) MODULE="$arg" ;;
    esac
done

# ─── 工具函数 ─────────────────────────────────────────

log_report() {
    REPORT_LINES+=("$1")
}

print_header() {
    local title="$1"
    echo ""
    echo -e "${CYAN}${BOLD}═══ $title ═══${RESET}"
    log_report ""
    log_report "=== $title ==="
}

# 通用测试函数
# run_test <id> <name> <curl_cmd> <expected_code> [check_cmd]
run_test() {
    local id="$1"
    local name="$2"
    local cmd="$3"
    local expected_code="$4"
    local check_cmd="$5"

    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "$id" "$name"

    RESPONSE=$(eval "$cmd" 2>/dev/null)
    local exit_code=$?

    if [ $exit_code -ne 0 ] && [ -z "$RESPONSE" ]; then
        echo -e "${RED}FAIL${RESET} (curl 执行失败, exit=$exit_code)"
        FAIL=$((FAIL + 1))
        log_report "  [$id] $name ... FAIL (curl error)"
        return 1
    fi

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "$expected_code" ]; then
        if [ -n "$check_cmd" ]; then
            if eval "$check_cmd" >/dev/null 2>&1; then
                echo -e "${GREEN}PASS${RESET}"
                PASS=$((PASS + 1))
                log_report "  [$id] $name ... PASS"
            else
                echo -e "${RED}FAIL${RESET} (验证失败)"
                FAIL=$((FAIL + 1))
                log_report "  [$id] $name ... FAIL (validation)"
                [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$BODY" | head -5)"
                return 1
            fi
        else
            echo -e "${GREEN}PASS${RESET}"
            PASS=$((PASS + 1))
            log_report "  [$id] $name ... PASS"
        fi
    else
        echo -e "${RED}FAIL${RESET} (期望 $expected_code, 实际 $HTTP_CODE)"
        FAIL=$((FAIL + 1))
        log_report "  [$id] $name ... FAIL (expected $expected_code, got $HTTP_CODE)"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$BODY" | head -5)"
        return 1
    fi
    return 0
}

# 跳过测试
skip_test() {
    local id="$1"
    local name="$2"
    local reason="$3"
    TOTAL=$((TOTAL + 1))
    SKIP=$((SKIP + 1))
    printf "  [%-6s] %-50s " "$id" "$name"
    echo -e "${YELLOW}SKIP${RESET} ($reason)"
    log_report "  [$id] $name ... SKIP ($reason)"
}

# 带认证的 curl
auth_curl() {
    curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@" -w "\n%{http_code}"
}

# 无认证的 curl
noauth_curl() {
    curl -s -H "Content-Type: application/json" "$@" -w "\n%{http_code}"
}

# ─── 登录获取 TOKEN ──────────────────────────────────
login() {
    echo -e "${BOLD}▶ 登录获取 Token ...${RESET}"
    local resp
    resp=$(curl -s -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
        -w "\n%{http_code}")

    local code
    code=$(echo "$resp" | tail -1)
    local body
    body=$(echo "$resp" | sed '$d')

    if [ "$code" != "200" ]; then
        echo -e "${RED}登录失败! HTTP $code${RESET}"
        echo "Response: $body"
        echo "请确保 Enterprise Gateway 已启动: $BASE_URL"
        exit 1
    fi

    TOKEN=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)
    REFRESH_TOKEN=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])" 2>/dev/null)
    USER_ID=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)

    if [ -z "$TOKEN" ]; then
        echo -e "${RED}无法解析 Token!${RESET}"
        echo "Response: $body"
        exit 1
    fi

    echo -e "  Token: ${GREEN}OK${RESET}  (userId=$USER_ID)"
    log_report "Login: OK (userId=$USER_ID)"
}

# ═══════════════════════════════════════════════════════
# 测试模块
# ═══════════════════════════════════════════════════════

test_health() {
    print_header "Health 健康检查"

    run_test "H-01" "健康检查端点" \
        "noauth_curl '$BASE_URL/health'" \
        "200"
}

test_auth() {
    print_header "Auth 认证模块"

    # A-01: 正常登录
    run_test "A-01" "正常登录" \
        "noauth_curl -X POST '$BASE_URL/api/auth/login' -d '{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'accessToken' in d\""

    # A-02: 错误密码
    run_test "A-02" "错误密码 → 401" \
        "noauth_curl -X POST '$BASE_URL/api/auth/login' -d '{\"username\":\"$USERNAME\",\"password\":\"wrongpass\"}'" \
        "401"

    # A-03: 空用户名
    run_test "A-03" "空用户名 → 400" \
        "noauth_curl -X POST '$BASE_URL/api/auth/login' -d '{\"username\":\"\",\"password\":\"test\"}'" \
        "400"

    # A-04: Token 刷新
    run_test "A-04" "Token 刷新" \
        "noauth_curl -X POST '$BASE_URL/api/auth/refresh' -d '{\"refreshToken\":\"$REFRESH_TOKEN\"}'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'accessToken' in d\""

    # A-05: 获取当前用户
    run_test "A-05" "获取当前用户 /me" \
        "auth_curl '$BASE_URL/api/auth/me'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert d.get('username')=='$USERNAME'\""

    # A-06: 无 token 访问
    run_test "A-06" "无 Token 访问 /me → 401" \
        "noauth_curl '$BASE_URL/api/auth/me'" \
        "401"
}

test_chat() {
    print_header "Chat 对话模块"

    # C-01: 获取模型列表
    run_test "C-01" "获取模型列表" \
        "auth_curl '$BASE_URL/api/chat/models'" \
        "200"

    # C-02: 发送消息（非流式，timeout 90s）
    run_test "C-02" "发送消息（非流式）" \
        "auth_curl -X POST '$BASE_URL/api/chat' -d '{\"message\":\"请回复：测试成功\",\"stream\":false}' --max-time 90" \
        "200"

    # C-03: 获取会话列表
    run_test "C-03" "获取会话列表" \
        "auth_curl '$BASE_URL/api/chat/sessions'" \
        "200"

    # C-04: 获取历史记录（使用第一个 session）
    local sessions_resp
    sessions_resp=$(auth_curl "$BASE_URL/api/chat/sessions" 2>/dev/null)
    local sessions_body
    sessions_body=$(echo "$sessions_resp" | sed '$d')
    local first_session
    first_session=$(echo "$sessions_body" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    sessions = d.get('sessions', d.get('data', []))
    if sessions: print(sessions[0].get('id', sessions[0].get('sessionId','')))
    else: print('')
except: print('')
" 2>/dev/null)

    if [ -n "$first_session" ] && [ "$first_session" != "" ]; then
        run_test "C-04" "获取历史记录" \
            "auth_curl '$BASE_URL/api/chat/history/$first_session'" \
            "200"
    else
        skip_test "C-04" "获取历史记录" "无可用 session"
    fi
}

test_agents() {
    print_header "Agents 管理模块"

    # AG-01: 列出 agents
    run_test "AG-01" "列出 agents" \
        "auth_curl '$BASE_URL/api/agents'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'agents' in d\""

    # AG-02: 创建 agent
    local create_resp
    create_resp=$(auth_curl -X POST "$BASE_URL/api/agents" \
        -d '{"name":"test-auto-agent","identity":{"name":"Test Bot","emoji":"🤖"}}' 2>/dev/null)
    local create_code
    create_code=$(echo "$create_resp" | tail -1)
    local create_body
    create_body=$(echo "$create_resp" | sed '$d')
    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "AG-02" "创建 agent"
    if [ "$create_code" = "200" ] || [ "$create_code" = "201" ]; then
        TEMP_AGENT_ID=$(echo "$create_body" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])" 2>/dev/null)
        echo -e "${GREEN}PASS${RESET} (id=$TEMP_AGENT_ID)"
        PASS=$((PASS + 1))
        log_report "  [AG-02] 创建 agent ... PASS"
    else
        echo -e "${RED}FAIL${RESET} (HTTP $create_code)"
        FAIL=$((FAIL + 1))
        log_report "  [AG-02] 创建 agent ... FAIL"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$create_body" | head -3)"
    fi

    # AG-03: 更新 agent
    if [ -n "$TEMP_AGENT_ID" ]; then
        run_test "AG-03" "更新 agent" \
            "auth_curl -X PUT '$BASE_URL/api/agents/$TEMP_AGENT_ID' -d '{\"identity\":{\"name\":\"Updated Bot\",\"emoji\":\"🧪\"}}'" \
            "200"
    else
        skip_test "AG-03" "更新 agent" "无测试 agent"
    fi

    # AG-04: 获取配置文件
    if [ -n "$TEMP_AGENT_ID" ]; then
        run_test "AG-04" "获取 agent 配置文件" \
            "auth_curl '$BASE_URL/api/agents/$TEMP_AGENT_ID/config'" \
            "200" \
            "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'files' in d\""
    else
        skip_test "AG-04" "获取 agent 配置文件" "无测试 agent"
    fi

    # AG-05: 删除 default agent → 400
    # 先找到 default agent 的 id
    local agents_resp
    agents_resp=$(auth_curl "$BASE_URL/api/agents" 2>/dev/null)
    local agents_body
    agents_body=$(echo "$agents_resp" | sed '$d')
    local default_agent_id
    default_agent_id=$(echo "$agents_body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('agents',[]):
    if a.get('name')=='default':
        print(a['id'])
        break
" 2>/dev/null)

    if [ -n "$default_agent_id" ]; then
        run_test "AG-05" "删除 default agent → 400" \
            "auth_curl -X DELETE '$BASE_URL/api/agents/$default_agent_id'" \
            "400"
    else
        skip_test "AG-05" "删除 default agent → 400" "未找到 default agent"
    fi

    # AG-06: 删除测试 agent（清理）
    if [ -n "$TEMP_AGENT_ID" ]; then
        run_test "AG-06" "删除测试 agent" \
            "auth_curl -X DELETE '$BASE_URL/api/agents/$TEMP_AGENT_ID'" \
            "200"
        TEMP_AGENT_ID=""  # 已清理
    else
        skip_test "AG-06" "删除测试 agent" "无测试 agent"
    fi
}

test_admin() {
    print_header "Admin 管理模块"

    # AD-01: 用户列表
    run_test "AD-01" "用户列表" \
        "auth_curl '$BASE_URL/api/admin/users'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'data' in d and 'total' in d\""

    # AD-02: 创建测试用户
    local ts
    ts=$(date +%s)
    local test_username="testuser-${ts}"
    local create_resp
    create_resp=$(auth_curl -X POST "$BASE_URL/api/admin/users" \
        -d "{\"username\":\"$test_username\",\"email\":\"${test_username}@test.com\",\"displayName\":\"Test User\",\"department\":\"QA\",\"roles\":[\"USER\"],\"password\":\"testpass123\"}" 2>/dev/null)
    local create_code
    create_code=$(echo "$create_resp" | tail -1)
    local create_body
    create_body=$(echo "$create_resp" | sed '$d')
    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "AD-02" "创建测试用户"
    if [ "$create_code" = "201" ]; then
        TEMP_USER_ID=$(echo "$create_body" | python3 -c "import sys,json; print(json.load(sys.stdin)['userId'])" 2>/dev/null)
        echo -e "${GREEN}PASS${RESET} (userId=$TEMP_USER_ID)"
        PASS=$((PASS + 1))
        log_report "  [AD-02] 创建测试用户 ... PASS"
    else
        echo -e "${RED}FAIL${RESET} (HTTP $create_code)"
        FAIL=$((FAIL + 1))
        log_report "  [AD-02] 创建测试用户 ... FAIL"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$create_body" | head -3)"
    fi

    # AD-03: 更新测试用户
    if [ -n "$TEMP_USER_ID" ]; then
        run_test "AD-03" "更新测试用户" \
            "auth_curl -X PUT '$BASE_URL/api/admin/users/$TEMP_USER_ID' -d '{\"displayName\":\"Updated Test User\"}'" \
            "200"
    else
        skip_test "AD-03" "更新测试用户" "无测试用户"
    fi

    # AD-04: 仪表盘统计
    run_test "AD-04" "仪表盘统计" \
        "auth_curl '$BASE_URL/api/admin/dashboard'" \
        "200" \
        "echo \"\$BODY\" | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'totalUsers' in d\""

    # AD-05: 删除测试用户（清理）
    if [ -n "$TEMP_USER_ID" ]; then
        run_test "AD-05" "删除测试用户" \
            "auth_curl -X DELETE '$BASE_URL/api/admin/users/$TEMP_USER_ID'" \
            "200"
        TEMP_USER_ID=""  # 已清理
    else
        skip_test "AD-05" "删除测试用户" "无测试用户"
    fi
}

test_audit() {
    print_header "Audit 审计日志模块"

    # AU-01: 查询日志
    run_test "AU-01" "查询审计日志" \
        "auth_curl '$BASE_URL/api/audit/logs?page=1&pageSize=5'" \
        "200"

    # AU-02: 导出 CSV
    run_test "AU-02" "导出 CSV" \
        "auth_curl '$BASE_URL/api/audit/export?format=csv'" \
        "200"

    # AU-03: 统计信息
    run_test "AU-03" "审计统计" \
        "auth_curl '$BASE_URL/api/audit/stats'" \
        "200"
}

test_files() {
    print_header "Files 文件管理模块"

    # F-01: 上传文件
    local upload_resp
    local tmp_file="/tmp/octopus_test_upload_$$.txt"
    echo "Octopus Enterprise Test File - $(date)" > "$tmp_file"
    upload_resp=$(curl -s -H "Authorization: Bearer $TOKEN" \
        -F "file=@$tmp_file;filename=test-upload.txt" \
        "$BASE_URL/api/files/upload" \
        -w "\n%{http_code}" 2>/dev/null)
    rm -f "$tmp_file"
    local upload_code
    upload_code=$(echo "$upload_resp" | tail -1)
    local upload_body
    upload_body=$(echo "$upload_resp" | sed '$d')
    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "F-01" "上传文件"
    if [ "$upload_code" = "200" ] || [ "$upload_code" = "201" ]; then
        TEMP_FILE_NAME="test-upload.txt"
        echo -e "${GREEN}PASS${RESET}"
        PASS=$((PASS + 1))
        log_report "  [F-01] 上传文件 ... PASS"
    else
        echo -e "${RED}FAIL${RESET} (HTTP $upload_code)"
        FAIL=$((FAIL + 1))
        log_report "  [F-01] 上传文件 ... FAIL"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$upload_body" | head -3)"
    fi

    # F-02: 列出文件
    run_test "F-02" "列出文件" \
        "auth_curl '$BASE_URL/api/files/list?dir=files'" \
        "200"

    # F-03: 下载文件
    if [ -n "$TEMP_FILE_NAME" ]; then
        run_test "F-03" "下载文件" \
            "auth_curl '$BASE_URL/api/files/download/files/$TEMP_FILE_NAME'" \
            "200"
    else
        skip_test "F-03" "下载文件" "无测试文件"
    fi

    # F-04: 路径穿越防护（400/403/404 均为安全拦截）
    run_test "F-04" "路径穿越防护 → 非200" \
        "auth_curl '$BASE_URL/api/files/download/../../../etc/passwd'" \
        "404"
    # 如果不是 400 就尝试 403
    if [ "$HTTP_CODE" != "400" ] && [ "$HTTP_CODE" != "403" ]; then
        # 上面已经计数了，这里只是备注
        true
    fi

    # F-05: 删除文件（清理）
    if [ -n "$TEMP_FILE_NAME" ]; then
        run_test "F-05" "删除文件" \
            "auth_curl -X DELETE '$BASE_URL/api/files/files/$TEMP_FILE_NAME'" \
            "200"
        TEMP_FILE_NAME=""
    else
        skip_test "F-05" "删除文件" "无测试文件"
    fi
}

test_skills() {
    print_header "Skills 技能模块"

    # SK-01: 列出企业技能
    run_test "SK-01" "列出企业技能" \
        "auth_curl '$BASE_URL/api/skills'" \
        "200"

    # SK-02: 列出个人技能
    run_test "SK-02" "列出个人技能" \
        "auth_curl '$BASE_URL/api/skills/personal'" \
        "200"
}

test_mcp() {
    print_header "MCP 模块"

    # M-01: 列出企业 MCP
    run_test "M-01" "列出企业 MCP" \
        "auth_curl '$BASE_URL/api/mcp/servers'" \
        "200"

    # M-02: 列出个人 MCP
    run_test "M-02" "列出个人 MCP" \
        "auth_curl '$BASE_URL/api/mcp/personal'" \
        "200"
}

test_scheduler() {
    print_header "Scheduler 定时任务模块"

    # SC-01: 列出任务
    run_test "SC-01" "列出定时任务" \
        "auth_curl '$BASE_URL/api/scheduler/tasks'" \
        "200"

    # SC-02: 创建定时任务
    local create_resp
    create_resp=$(auth_curl -X POST "$BASE_URL/api/scheduler/tasks" \
        -d '{"name":"Auto Test Task","cron":"0 0 1 1 *","taskType":"skill","taskConfig":{"skillId":"test","prompt":"test"}}' 2>/dev/null)
    local create_code
    create_code=$(echo "$create_resp" | tail -1)
    local create_body
    create_body=$(echo "$create_resp" | sed '$d')
    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "SC-02" "创建定时任务"
    if [ "$create_code" = "200" ] || [ "$create_code" = "201" ]; then
        TEMP_SCHEDULER_ID=$(echo "$create_body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# 尝试多种结构提取 id
task = d.get('task', d)
print(task.get('id', task.get('cronId', '')))" 2>/dev/null)
        echo -e "${GREEN}PASS${RESET} (id=$TEMP_SCHEDULER_ID)"
        PASS=$((PASS + 1))
        log_report "  [SC-02] 创建定时任务 ... PASS"
    else
        echo -e "${RED}FAIL${RESET} (HTTP $create_code)"
        FAIL=$((FAIL + 1))
        log_report "  [SC-02] 创建定时任务 ... FAIL"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$create_body" | head -3)"
    fi

    # SC-03: 删除定时任务（清理）
    if [ -n "$TEMP_SCHEDULER_ID" ]; then
        run_test "SC-03" "删除定时任务" \
            "auth_curl -X DELETE '$BASE_URL/api/scheduler/tasks/$TEMP_SCHEDULER_ID'" \
            "200"
        TEMP_SCHEDULER_ID=""
    else
        skip_test "SC-03" "删除定时任务" "无测试任务"
    fi
}

test_quotas() {
    print_header "Quotas 配额模块"

    # Q-01: 获取配额
    run_test "Q-01" "获取用户配额" \
        "auth_curl '$BASE_URL/api/quotas/$USER_ID'" \
        "200"
}

test_env() {
    print_header "Env 环境变量模块"

    # E-01: 获取环境变量
    run_test "E-01" "获取用户环境变量" \
        "auth_curl '$BASE_URL/api/user/env'" \
        "200"

    # E-02: 写入环境变量
    run_test "E-02" "写入用户环境变量" \
        "auth_curl -X PUT '$BASE_URL/api/user/env' -d '{\"content\":\"# Test env\\nTEST_VAR=hello\"}'" \
        "200"
}

test_db_conn() {
    print_header "DB-Conn 数据库连接模块"

    # DC-01: 列出连接
    run_test "DC-01" "列出数据库连接" \
        "auth_curl '$BASE_URL/api/user/db-connections'" \
        "200"

    # DC-02: 创建连接
    local ts
    ts=$(date +%s)
    local create_resp
    create_resp=$(auth_curl -X POST "$BASE_URL/api/user/db-connections" \
        -d "{\"name\":\"test-conn-${ts}\",\"dbType\":\"mysql\",\"host\":\"localhost\",\"port\":3306,\"dbName\":\"test\",\"dbUser\":\"test\",\"dbPassword\":\"test123\"}" 2>/dev/null)
    local create_code
    create_code=$(echo "$create_resp" | tail -1)
    local create_body
    create_body=$(echo "$create_resp" | sed '$d')
    TOTAL=$((TOTAL + 1))
    printf "  [%-6s] %-50s " "DC-02" "创建数据库连接"
    if [ "$create_code" = "200" ] || [ "$create_code" = "201" ]; then
        TEMP_DB_CONN_ID=$(echo "$create_body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
conn = d.get('connection', d)
print(conn.get('id', ''))" 2>/dev/null)
        echo -e "${GREEN}PASS${RESET} (id=$TEMP_DB_CONN_ID)"
        PASS=$((PASS + 1))
        log_report "  [DC-02] 创建数据库连接 ... PASS"
    else
        echo -e "${RED}FAIL${RESET} (HTTP $create_code)"
        FAIL=$((FAIL + 1))
        log_report "  [DC-02] 创建数据库连接 ... FAIL"
        [ "$VERBOSE" = "1" ] && echo "    Response: $(echo "$create_body" | head -3)"
    fi

    # DC-03: 删除连接（清理）
    if [ -n "$TEMP_DB_CONN_ID" ]; then
        run_test "DC-03" "删除数据库连接" \
            "auth_curl -X DELETE '$BASE_URL/api/user/db-connections/$TEMP_DB_CONN_ID'" \
            "200"
        TEMP_DB_CONN_ID=""
    else
        skip_test "DC-03" "删除数据库连接" "无测试连接"
    fi
}

test_security() {
    print_header "Security 安全测试"

    # S-01: JWT 伪造
    run_test "S-01" "JWT 伪造 → 401" \
        "curl -s -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImZha2UiLCJ1c2VybmFtZSI6ImhhY2tlciIsInJvbGVzIjpbIkFETUlOIl19.invalid_signature' '$BASE_URL/api/auth/me' -w '\n%{http_code}'" \
        "401"

    # S-02: 无 token 访问保护端点
    run_test "S-02" "无 Token 访问 /agents → 401" \
        "noauth_curl '$BASE_URL/api/agents'" \
        "401"

    # S-03: 无 token 访问 admin
    run_test "S-03" "无 Token 访问 /admin → 401" \
        "noauth_curl '$BASE_URL/api/admin/users'" \
        "401"

    # S-04: 路径穿越 (files) — 404/403/400 均可接受
    run_test "S-04" "路径穿越 files → 非200" \
        "auth_curl '$BASE_URL/api/files/download/../../etc/passwd'" \
        "404"

    # S-05: 路径穿越 (encoded) — 403/400 均可接受
    run_test "S-05" "路径穿越 encoded → 非200" \
        "auth_curl '$BASE_URL/api/files/download/..%2F..%2Fetc%2Fpasswd'" \
        "403"
}

# ─── 清理残留测试数据 ─────────────────────────────────
cleanup() {
    local cleaned=0
    if [ -n "$TEMP_AGENT_ID" ]; then
        auth_curl -X DELETE "$BASE_URL/api/agents/$TEMP_AGENT_ID" >/dev/null 2>&1
        cleaned=$((cleaned + 1))
    fi
    if [ -n "$TEMP_USER_ID" ]; then
        auth_curl -X DELETE "$BASE_URL/api/admin/users/$TEMP_USER_ID" >/dev/null 2>&1
        cleaned=$((cleaned + 1))
    fi
    if [ -n "$TEMP_SCHEDULER_ID" ]; then
        auth_curl -X DELETE "$BASE_URL/api/scheduler/tasks/$TEMP_SCHEDULER_ID" >/dev/null 2>&1
        cleaned=$((cleaned + 1))
    fi
    if [ -n "$TEMP_DB_CONN_ID" ]; then
        auth_curl -X DELETE "$BASE_URL/api/user/db-connections/$TEMP_DB_CONN_ID" >/dev/null 2>&1
        cleaned=$((cleaned + 1))
    fi
    if [ $cleaned -gt 0 ]; then
        echo -e "\n${YELLOW}清理了 $cleaned 个残留测试数据${RESET}"
    fi
}

# ─── 打印总结 ─────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${BOLD}════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}  测试结果总结${RESET}"
    echo -e "${BOLD}════════════════════════════════════════════${RESET}"
    echo -e "  总计: ${BOLD}$TOTAL${RESET}"
    echo -e "  通过: ${GREEN}${BOLD}$PASS${RESET}"
    echo -e "  失败: ${RED}${BOLD}$FAIL${RESET}"
    echo -e "  跳过: ${YELLOW}${BOLD}$SKIP${RESET}"
    echo -e "${BOLD}════════════════════════════════════════════${RESET}"

    if [ "$FAIL" -eq 0 ]; then
        echo -e "  ${GREEN}${BOLD}ALL TESTS PASSED${RESET}"
    else
        echo -e "  ${RED}${BOLD}$FAIL TEST(S) FAILED${RESET}"
    fi
    echo ""

    # 写报告文件
    {
        echo "Octopus Enterprise 自动化测试报告"
        echo "运行时间: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "模块: $MODULE"
        echo "────────────────────────────────────"
        for line in "${REPORT_LINES[@]}"; do
            echo "$line"
        done
        echo ""
        echo "────────────────────────────────────"
        echo "总计: $TOTAL | 通过: $PASS | 失败: $FAIL | 跳过: $SKIP"
        if [ "$FAIL" -eq 0 ]; then
            echo "结果: ALL TESTS PASSED"
        else
            echo "结果: $FAIL TEST(S) FAILED"
        fi
    } > "$REPORT_FILE"

    echo -e "报告已保存: ${CYAN}$REPORT_FILE${RESET}"
}

# ─── 主流程 ───────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}╔═══════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}║   Octopus Enterprise 自动化测试          ║${RESET}"
    echo -e "${BOLD}╚═══════════════════════════════════════════╝${RESET}"
    echo -e "  服务地址: $BASE_URL"
    echo -e "  测试模块: $MODULE"
    echo -e "  详细模式: $([ "$VERBOSE" = "1" ] && echo "ON" || echo "OFF")"
    echo ""

    # 先检查服务是否可达
    if ! curl -s --max-time 5 "$BASE_URL/health" >/dev/null 2>&1; then
        echo -e "${RED}错误: Enterprise Gateway 不可达 ($BASE_URL)${RESET}"
        echo "请先启动服务: ./start-dev.sh start"
        exit 1
    fi

    # 登录
    login

    # 根据模块运行测试
    case "$MODULE" in
        all)
            test_health
            test_auth
            test_chat
            test_agents
            test_admin
            test_audit
            test_files
            test_skills
            test_mcp
            test_scheduler
            test_quotas
            test_env
            test_db_conn
            test_security
            ;;
        health)    test_health ;;
        auth)      test_auth ;;
        chat)      test_chat ;;
        agents)    test_agents ;;
        admin)     test_admin ;;
        audit)     test_audit ;;
        files)     test_files ;;
        skills)    test_skills ;;
        mcp)       test_mcp ;;
        scheduler) test_scheduler ;;
        quotas)    test_quotas ;;
        env)       test_env ;;
        db-conn)   test_db_conn ;;
        security)  test_security ;;
        *)
            echo -e "${RED}未知模块: $MODULE${RESET}"
            echo "可用模块: auth, chat, agents, admin, audit, files, skills, mcp, scheduler, quotas, env, db-conn, health, security, all"
            exit 1
            ;;
    esac

    # 清理
    cleanup

    # 总结
    print_summary

    # 退出码
    [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}

main
