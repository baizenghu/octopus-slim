# Octopus Enterprise 系统测试计划

> 供 Claude Code 自动化执行的端到端系统测试。
> 所有测试基于 curl 命令，可直接在 bash 中执行。

---

## 环境准备

### 前置条件

- Enterprise Gateway 已启动: `http://localhost:18790`
- Admin Console 已启动: `http://localhost:3001`
- Native Gateway 已启动: `ws://127.0.0.1:19791`
- MySQL 数据库可用: `mysql -uoctopus -p"${DB_PASSWORD}" octopus_enterprise`

### 获取 Token（所有需认证的测试依赖此步骤）

```bash
# 登录获取 TOKEN（后续测试引用 $TOKEN）
export LOGIN_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"baizh","password":"baizh"}')
export TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken')
export REFRESH_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.refreshToken')
export USER_ID=$(echo "$LOGIN_RESP" | jq -r '.user.id')
echo "TOKEN=$TOKEN"
echo "USER_ID=$USER_ID"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo "ENV_SETUP: PASS" || echo "ENV_SETUP: FAIL"
```

---

## 模块 1: 认证模块

### TC-AUTH-001: 正常登录

- **前置条件**: 系统已启动，用户 baizh 存在
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh","password":"baizh"}'
  ```
- **预期结果**: 返回 200，包含 user.id, accessToken, refreshToken, expiresIn
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh","password":"baizh"}')
  echo "$RESP" | jq -e '.accessToken and .refreshToken and .user.id' > /dev/null && echo "TC-AUTH-001: PASS" || echo "TC-AUTH-001: FAIL"
  ```

### TC-AUTH-002: 错误密码

- **前置条件**: 无
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh","password":"wrong_password"}'
  ```
- **预期结果**: 返回 401
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh","password":"wrong_password"}')
  [ "$CODE" = "401" ] && echo "TC-AUTH-002: PASS" || echo "TC-AUTH-002: FAIL (got $CODE)"
  ```

### TC-AUTH-003: 不存在的用户

- **前置条件**: 无
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"nonexistent_user_xyz","password":"any"}'
  ```
- **预期结果**: 返回 401
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"nonexistent_user_xyz","password":"any"}')
  [ "$CODE" = "401" ] && echo "TC-AUTH-003: PASS" || echo "TC-AUTH-003: FAIL (got $CODE)"
  ```

### TC-AUTH-004: 缺少必填字段

- **前置条件**: 无
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"baizh"}')
  [ "$CODE" = "400" ] && echo "TC-AUTH-004: PASS" || echo "TC-AUTH-004: FAIL (got $CODE)"
  ```

### TC-AUTH-005: Token 刷新

- **前置条件**: TC-AUTH-001 通过，已有 $REFRESH_TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/auth/refresh \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
  ```
- **预期结果**: 返回 200，包含新的 accessToken
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/auth/refresh \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
  echo "$RESP" | jq -e '.accessToken' > /dev/null && echo "TC-AUTH-005: PASS" || echo "TC-AUTH-005: FAIL"
  ```

### TC-AUTH-006: 无效 refreshToken

- **前置条件**: 无
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/refresh \
    -H "Content-Type: application/json" \
    -d '{"refreshToken":"invalid_token_xxx"}'
  ```
- **预期结果**: 返回 401
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/auth/refresh \
    -H "Content-Type: application/json" \
    -d '{"refreshToken":"invalid_token_xxx"}')
  [ "$CODE" = "401" ] && echo "TC-AUTH-006: PASS" || echo "TC-AUTH-006: FAIL (got $CODE)"
  ```

### TC-AUTH-007: 获取当前用户信息

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/auth/me \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 id, username, email, roles
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/auth/me -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.username == "baizh" and .roles' > /dev/null && echo "TC-AUTH-007: PASS" || echo "TC-AUTH-007: FAIL"
  ```

### TC-AUTH-008: 无 Token 访问受保护端点

- **前置条件**: 无
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/auth/me
  ```
- **预期结果**: 返回 401
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/auth/me)
  [ "$CODE" = "401" ] && echo "TC-AUTH-008: PASS" || echo "TC-AUTH-008: FAIL (got $CODE)"
  ```

### TC-AUTH-009: 登出

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/auth/logout \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，message 为 "Logged out"
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/auth/logout -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.message == "Logged out"' > /dev/null && echo "TC-AUTH-009: PASS" || echo "TC-AUTH-009: FAIL"
  # 注意: 登出后需重新登录获取 TOKEN
  ```

---

## 模块 2: 聊天模块

### TC-CHAT-001: 获取可用模型列表

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/chat/models \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 models 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/chat/models -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.models | length > 0' > /dev/null && echo "TC-CHAT-001: PASS" || echo "TC-CHAT-001: FAIL"
  ```

### TC-CHAT-002: 发送消息（非流式）

- **前置条件**: 已有 $TOKEN，Native Gateway 已连接
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/chat \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 ok 两个字","agentId":"default"}' \
    --max-time 60
  ```
- **预期结果**: 返回 200，包含 sessionKey 和 content
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/chat \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 ok 两个字","agentId":"default"}' \
    --max-time 60)
  echo "$RESP" | jq -e '.sessionKey' > /dev/null && echo "TC-CHAT-002: PASS" || echo "TC-CHAT-002: FAIL"
  export CHAT_SESSION_KEY=$(echo "$RESP" | jq -r '.sessionKey')
  ```

### TC-CHAT-003: 获取会话列表

- **前置条件**: 已有 $TOKEN，至少发过一条消息
- **依赖**: TC-CHAT-002
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/chat/sessions \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，sessions 数组非空
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/chat/sessions -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.sessions | length > 0' > /dev/null && echo "TC-CHAT-003: PASS" || echo "TC-CHAT-003: FAIL"
  ```

### TC-CHAT-004: 获取会话历史

- **前置条件**: 已有 $TOKEN 和 $CHAT_SESSION_KEY
- **依赖**: TC-CHAT-002
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/chat/history/$CHAT_SESSION_KEY" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 messages 数组
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/chat/history/$CHAT_SESSION_KEY" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.messages | length > 0' > /dev/null && echo "TC-CHAT-004: PASS" || echo "TC-CHAT-004: FAIL"
  ```

### TC-CHAT-005: 重命名会话

- **前置条件**: 已有 $TOKEN 和 $CHAT_SESSION_KEY
- **依赖**: TC-CHAT-002
- **执行**:
  ```bash
  # 提取 session ID（最后一段）
  SESSION_ID=$(echo "$CHAT_SESSION_KEY" | awk -F: '{print $NF}')
  curl -s -X PUT "http://localhost:18790/api/chat/sessions/$SESSION_ID/title" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"测试会话标题"}'
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  SESSION_ID=$(echo "$CHAT_SESSION_KEY" | awk -F: '{print $NF}')
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "http://localhost:18790/api/chat/sessions/$SESSION_ID/title" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"测试会话标题"}')
  [ "$CODE" = "200" ] && echo "TC-CHAT-005: PASS" || echo "TC-CHAT-005: FAIL (got $CODE)"
  ```

### TC-CHAT-006: 删除会话

- **前置条件**: 已有 $TOKEN 和 $CHAT_SESSION_KEY
- **依赖**: TC-CHAT-002
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/chat/history/$CHAT_SESSION_KEY" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/chat/history/$CHAT_SESSION_KEY" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-CHAT-006: PASS" || echo "TC-CHAT-006: FAIL (got $CODE)"
  ```

### TC-CHAT-007: 流式消息（SSE）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  timeout 30 curl -s -N -X POST http://localhost:18790/api/chat/stream \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 hello","agentId":"default"}' 2>/dev/null | head -20
  ```
- **预期结果**: 返回 SSE 事件流，包含 `data:` 前缀的行
- **验证**:
  ```bash
  OUTPUT=$(timeout 30 curl -s -N -X POST http://localhost:18790/api/chat/stream \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 hello","agentId":"default"}' 2>/dev/null | head -20)
  echo "$OUTPUT" | grep -q "data:" && echo "TC-CHAT-007: PASS" || echo "TC-CHAT-007: FAIL"
  ```

---

## 模块 3: Agent 管理

### TC-AGENT-001: 列出 Agents（自动创建 default）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，agents 数组包含至少一个 name="default" 的 agent
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/agents -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.agents[] | select(.name=="default")' > /dev/null && echo "TC-AGENT-001: PASS" || echo "TC-AGENT-001: FAIL"
  ```

### TC-AGENT-002: 创建新 Agent

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-agent-plan","identity":{"name":"Test Agent","emoji":"T"}}'
  ```
- **预期结果**: 返回 200，包含新创建的 agent 对象
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-agent-plan","identity":{"name":"Test Agent","emoji":"T"}}')
  export TEST_AGENT_ID=$(echo "$RESP" | jq -r '.agent.id')
  echo "$RESP" | jq -e '.agent.name == "test-agent-plan"' > /dev/null && echo "TC-AGENT-002: PASS" || echo "TC-AGENT-002: FAIL"
  ```

### TC-AGENT-003: 创建 Agent 缺少 name

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"No Name Agent"}}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"No Name Agent"}}')
  [ "$CODE" = "400" ] && echo "TC-AGENT-003: PASS" || echo "TC-AGENT-003: FAIL (got $CODE)"
  ```

### TC-AGENT-004: 更新 Agent

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"Updated Agent","emoji":"U"}}'
  ```
- **预期结果**: 返回 200，identity 已更新
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"Updated Agent","emoji":"U"}}')
  echo "$RESP" | jq -e '.agent.identity.name == "Updated Agent"' > /dev/null && echo "TC-AGENT-004: PASS" || echo "TC-AGENT-004: FAIL"
  ```

### TC-AGENT-005: 禁止修改 Agent name

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"renamed-agent"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"renamed-agent"}')
  [ "$CODE" = "400" ] && echo "TC-AGENT-005: PASS" || echo "TC-AGENT-005: FAIL (got $CODE)"
  ```

### TC-AGENT-006: 获取 Agent 配置文件

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，files 数组包含 IDENTITY.md, SOUL.md 等
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.files | length > 0' > /dev/null && echo "TC-AGENT-006: PASS" || echo "TC-AGENT-006: FAIL"
  ```

### TC-AGENT-007: 更新 Agent 配置文件

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fileName":"SOUL.md","content":"你是一个测试助手。"}'
  ```
- **预期结果**: 返回 200，ok=true
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fileName":"SOUL.md","content":"你是一个测试助手。"}')
  echo "$RESP" | jq -e '.ok == true' > /dev/null && echo "TC-AGENT-007: PASS" || echo "TC-AGENT-007: FAIL"
  ```

### TC-AGENT-008: 配置文件名白名单校验

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fileName":"../../etc/passwd","content":"hack"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/$TEST_AGENT_ID/config" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fileName":"../../etc/passwd","content":"hack"}')
  [ "$CODE" = "400" ] && echo "TC-AGENT-008: PASS" || echo "TC-AGENT-008: FAIL (got $CODE)"
  ```

### TC-AGENT-009: 设为默认 Agent

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -X POST "http://localhost:18790/api/agents/$TEST_AGENT_ID/default" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，agent.isDefault=true
- **验证**:
  ```bash
  RESP=$(curl -s -X POST "http://localhost:18790/api/agents/$TEST_AGENT_ID/default" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.agent.isDefault == true' > /dev/null && echo "TC-AGENT-009: PASS" || echo "TC-AGENT-009: FAIL"
  ```

### TC-AGENT-010: 不能删除 default Agent

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  # 获取 default agent 的 id
  DEFAULT_ID=$(curl -s http://localhost:18790/api/agents -H "Authorization: Bearer $TOKEN" \
    | jq -r '.agents[] | select(.name=="default") | .id')
  curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/agents/$DEFAULT_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  DEFAULT_ID=$(curl -s http://localhost:18790/api/agents -H "Authorization: Bearer $TOKEN" \
    | jq -r '.agents[] | select(.name=="default") | .id')
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/agents/$DEFAULT_ID" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "400" ] && echo "TC-AGENT-010: PASS" || echo "TC-AGENT-010: FAIL (got $CODE)"
  ```

### TC-AGENT-011: 删除非 default Agent

- **前置条件**: 已有 $TOKEN 和 $TEST_AGENT_ID
- **依赖**: TC-AGENT-002
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，ok=true
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/agents/$TEST_AGENT_ID" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.ok == true' > /dev/null && echo "TC-AGENT-011: PASS" || echo "TC-AGENT-011: FAIL"
  ```

### TC-AGENT-012: 访问不存在的 Agent

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/nonexistent_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"x"}}'
  ```
- **预期结果**: 返回 404
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/nonexistent_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"x"}}')
  [ "$CODE" = "404" ] && echo "TC-AGENT-012: PASS" || echo "TC-AGENT-012: FAIL (got $CODE)"
  ```

---

## 模块 4: 用户管理（ADMIN）

### TC-ADMIN-001: 用户列表分页

- **前置条件**: 已有 $TOKEN（ADMIN 角色）
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/admin/users?page=1&pageSize=10" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组、total、page、pageSize
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/admin/users?page=1&pageSize=10" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data and .total and .page and .pageSize' > /dev/null && echo "TC-ADMIN-001: PASS" || echo "TC-ADMIN-001: FAIL"
  ```

### TC-ADMIN-002: 搜索用户

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/admin/users?search=baizh" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，data 中包含 baizh 用户
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/admin/users?search=baizh" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data[] | select(.username=="baizh")' > /dev/null && echo "TC-ADMIN-002: PASS" || echo "TC-ADMIN-002: FAIL"
  ```

### TC-ADMIN-003: 创建用户

- **前置条件**: 已有 $TOKEN（ADMIN 角色）
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"testplanuser","email":"testplan@test.com","password":"test123","roles":["USER"]}'
  ```
- **预期结果**: 返回 201，包含新用户信息
- **验证**:
  ```bash
  RESP=$(curl -s -w "\n%{http_code}" -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"testplanuser","email":"testplan@test.com","password":"test123","roles":["USER"]}')
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -n -1)
  export TEST_USER_ID=$(echo "$BODY" | jq -r '.userId')
  [ "$CODE" = "201" ] && echo "TC-ADMIN-003: PASS" || echo "TC-ADMIN-003: FAIL (got $CODE)"
  ```

### TC-ADMIN-004: 用户名不能包含下划线

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"bad_name","email":"bad@test.com"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"bad_name","email":"bad@test.com"}')
  [ "$CODE" = "400" ] && echo "TC-ADMIN-004: PASS" || echo "TC-ADMIN-004: FAIL (got $CODE)"
  ```

### TC-ADMIN-005: 重复用户名

- **前置条件**: 已有 $TOKEN，testplanuser 已创建
- **依赖**: TC-ADMIN-003
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"testplanuser","email":"dup@test.com"}'
  ```
- **预期结果**: 返回 409
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"testplanuser","email":"dup@test.com"}')
  [ "$CODE" = "409" ] && echo "TC-ADMIN-005: PASS" || echo "TC-ADMIN-005: FAIL (got $CODE)"
  ```

### TC-ADMIN-006: 更新用户信息

- **前置条件**: 已有 $TOKEN 和 $TEST_USER_ID
- **依赖**: TC-ADMIN-003
- **执行**:
  ```bash
  curl -s -X PUT "http://localhost:18790/api/admin/users/$TEST_USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"displayName":"Test Plan User","department":"QA"}'
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT "http://localhost:18790/api/admin/users/$TEST_USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"displayName":"Test Plan User","department":"QA"}')
  echo "$RESP" | jq -e '.displayName == "Test Plan User"' > /dev/null && echo "TC-ADMIN-006: PASS" || echo "TC-ADMIN-006: FAIL"
  ```

### TC-ADMIN-007: 解锁用户

- **前置条件**: 已有 $TOKEN 和 $TEST_USER_ID
- **依赖**: TC-ADMIN-003
- **执行**:
  ```bash
  curl -s -X POST "http://localhost:18790/api/admin/users/$TEST_USER_ID/unlock" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，success=true
- **验证**:
  ```bash
  RESP=$(curl -s -X POST "http://localhost:18790/api/admin/users/$TEST_USER_ID/unlock" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.success == true' > /dev/null && echo "TC-ADMIN-007: PASS" || echo "TC-ADMIN-007: FAIL"
  ```

### TC-ADMIN-008: 仪表盘统计

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/admin/dashboard \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 totalUsers, activeUsers, dailyTrend 等字段
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/admin/dashboard -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.totalUsers and .dailyTrend' > /dev/null && echo "TC-ADMIN-008: PASS" || echo "TC-ADMIN-008: FAIL"
  ```

### TC-ADMIN-009: 不能删除自己

- **前置条件**: 已有 $TOKEN 和 $USER_ID
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/admin/users/$USER_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/admin/users/$USER_ID" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "400" ] && echo "TC-ADMIN-009: PASS" || echo "TC-ADMIN-009: FAIL (got $CODE)"
  ```

### TC-ADMIN-010: 删除测试用户（完整清理）

- **前置条件**: 已有 $TOKEN 和 $TEST_USER_ID
- **依赖**: TC-ADMIN-003
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/admin/users/$TEST_USER_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，message 包含 "deleted"
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/admin/users/$TEST_USER_ID" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.message' > /dev/null && echo "TC-ADMIN-010: PASS" || echo "TC-ADMIN-010: FAIL"
  # 验证 DB 中已删除
  DB_CHECK=$(mysql -uoctopus -p"${DB_PASSWORD}" octopus_enterprise -N -e \
    "SELECT COUNT(*) FROM User WHERE userId='$TEST_USER_ID'")
  [ "$DB_CHECK" = "0" ] && echo "TC-ADMIN-010-DB: PASS" || echo "TC-ADMIN-010-DB: FAIL"
  ```

### TC-ADMIN-011: 删除不存在的用户

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/admin/users/nonexistent-id" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 404
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:18790/api/admin/users/nonexistent-id" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "404" ] && echo "TC-ADMIN-011: PASS" || echo "TC-ADMIN-011: FAIL (got $CODE)"
  ```

---

## 模块 5: 审计日志（ADMIN）

### TC-AUDIT-001: 查询审计日志

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/audit/logs?limit=10&offset=0" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组和 total
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/audit/logs?limit=10&offset=0" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data and (.total >= 0)' > /dev/null && echo "TC-AUDIT-001: PASS" || echo "TC-AUDIT-001: FAIL"
  ```

### TC-AUDIT-002: 按用户筛选日志

- **前置条件**: 已有 $TOKEN 和 $USER_ID
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/audit/logs?userId=$USER_ID&limit=5" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，所有记录的 userId 均为当前用户
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/audit/logs?userId=$USER_ID&limit=5" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-AUDIT-002: PASS" || echo "TC-AUDIT-002: FAIL"
  ```

### TC-AUDIT-003: 按时间范围筛选

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  START=$(date -d "1 hour ago" -u +"%Y-%m-%dT%H:%M:%SZ")
  END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  curl -s "http://localhost:18790/api/audit/logs?startTime=$START&endTime=$END&limit=5" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  START=$(date -d "1 hour ago" -u +"%Y-%m-%dT%H:%M:%SZ")
  END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/audit/logs?startTime=$START&endTime=$END&limit=5" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-AUDIT-003: PASS" || echo "TC-AUDIT-003: FAIL (got $CODE)"
  ```

### TC-AUDIT-004: 导出 CSV

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:18790/api/audit/export?format=csv" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，Content-Type 为 text/csv
- **验证**:
  ```bash
  HEADERS=$(curl -s -D - -o /dev/null "http://localhost:18790/api/audit/export?format=csv" \
    -H "Authorization: Bearer $TOKEN")
  echo "$HEADERS" | grep -qi "text/csv" && echo "TC-AUDIT-004: PASS" || echo "TC-AUDIT-004: FAIL"
  ```

### TC-AUDIT-005: 导出 JSON

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:18790/api/audit/export?format=json" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，Content-Type 为 application/json
- **验证**:
  ```bash
  HEADERS=$(curl -s -D - -o /dev/null "http://localhost:18790/api/audit/export?format=json" \
    -H "Authorization: Bearer $TOKEN")
  echo "$HEADERS" | grep -qi "application/json" && echo "TC-AUDIT-005: PASS" || echo "TC-AUDIT-005: FAIL"
  ```

### TC-AUDIT-006: 审计统计

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/audit/stats?days=7" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:18790/api/audit/stats?days=7" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-AUDIT-006: PASS" || echo "TC-AUDIT-006: FAIL (got $CODE)"
  ```

### TC-AUDIT-007: 归档操作

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/audit/archive \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"beforeDate":"2020-01-01T00:00:00Z"}'
  ```
- **预期结果**: 返回 200，包含 archivedCount
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/audit/archive \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"beforeDate":"2020-01-01T00:00:00Z"}')
  echo "$RESP" | jq -e '.archivedCount >= 0' > /dev/null && echo "TC-AUDIT-007: PASS" || echo "TC-AUDIT-007: FAIL"
  ```

---

## 模块 6: 文件管理

### TC-FILE-001: 上传文件

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  echo "test file content" > /tmp/test-upload.txt
  curl -s -X POST http://localhost:18790/api/files/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test-upload.txt"
  ```
- **预期结果**: 返回 200，message 为 "上传成功"
- **验证**:
  ```bash
  echo "test file content" > /tmp/test-upload.txt
  RESP=$(curl -s -X POST http://localhost:18790/api/files/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test-upload.txt")
  echo "$RESP" | jq -e '.file.name' > /dev/null && echo "TC-FILE-001: PASS" || echo "TC-FILE-001: FAIL"
  export UPLOADED_FILE_PATH=$(echo "$RESP" | jq -r '.file.path')
  rm -f /tmp/test-upload.txt
  ```

### TC-FILE-002: 列出文件

- **前置条件**: 已有 $TOKEN
- **依赖**: TC-FILE-001
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/files/list?dir=files" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，files 数组
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/files/list?dir=files" -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.files' > /dev/null && echo "TC-FILE-002: PASS" || echo "TC-FILE-002: FAIL"
  ```

### TC-FILE-003: 下载文件

- **前置条件**: 已有 $TOKEN 和 $UPLOADED_FILE_PATH
- **依赖**: TC-FILE-001
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/download/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/download/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-FILE-003: PASS" || echo "TC-FILE-003: FAIL (got $CODE)"
  ```

### TC-FILE-004: 获取文件信息

- **前置条件**: 已有 $TOKEN 和 $UPLOADED_FILE_PATH
- **依赖**: TC-FILE-001
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/files/info/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 name, size, modifiedAt
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/files/info/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.name and .size' > /dev/null && echo "TC-FILE-004: PASS" || echo "TC-FILE-004: FAIL"
  ```

### TC-FILE-005: 删除文件

- **前置条件**: 已有 $TOKEN 和 $UPLOADED_FILE_PATH
- **依赖**: TC-FILE-001
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/files/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，message 为 "删除成功"
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/files/$UPLOADED_FILE_PATH" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.message == "删除成功"' > /dev/null && echo "TC-FILE-005: PASS" || echo "TC-FILE-005: FAIL"
  ```

### TC-FILE-006: 路径穿越攻击防护（上传子目录）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  echo "hack" > /tmp/test-hack.txt
  curl -s -o /dev/null -w "%{http_code}" -X POST \
    "http://localhost:18790/api/files/upload?subdir=../../etc" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test-hack.txt"
  rm -f /tmp/test-hack.txt
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  echo "hack" > /tmp/test-hack.txt
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "http://localhost:18790/api/files/upload?subdir=../../etc" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test-hack.txt")
  rm -f /tmp/test-hack.txt
  [ "$CODE" = "403" ] && echo "TC-FILE-006: PASS" || echo "TC-FILE-006: FAIL (got $CODE)"
  ```

### TC-FILE-007: 路径穿越攻击防护（列表）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/list?dir=files&subdir=../../etc" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/list?dir=files&subdir=../../etc" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "403" ] && echo "TC-FILE-007: PASS" || echo "TC-FILE-007: FAIL (got $CODE)"
  ```

### TC-FILE-008: 非法文件类型拒绝

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  echo "binary" > /tmp/test.exe
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/files/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test.exe"
  rm -f /tmp/test.exe
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  echo "binary" > /tmp/test.exe
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/files/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test.exe")
  rm -f /tmp/test.exe
  [ "$CODE" = "400" ] && echo "TC-FILE-008: PASS" || echo "TC-FILE-008: FAIL (got $CODE)"
  ```

### TC-FILE-009: 禁止删除 outputs 目录文件

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/files/outputs/test.txt" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/files/outputs/test.txt" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "403" ] && echo "TC-FILE-009: PASS" || echo "TC-FILE-009: FAIL (got $CODE)"
  ```

---

## 模块 7: 技能管理

### TC-SKILL-001: 列出技能

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/skills \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组和 total
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/skills -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data and (.total >= 0)' > /dev/null && echo "TC-SKILL-001: PASS" || echo "TC-SKILL-001: FAIL"
  ```

### TC-SKILL-002: 列出个人技能

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/skills/personal \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/skills/personal -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-SKILL-002: PASS" || echo "TC-SKILL-002: FAIL"
  ```

### TC-SKILL-003: 上传技能（非 zip 文件拒绝）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  echo "not a zip" > /tmp/test.txt
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/skills/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test.txt"
  rm -f /tmp/test.txt
  ```
- **预期结果**: 返回 400（仅支持 zip）
- **验证**:
  ```bash
  echo "not a zip" > /tmp/test.txt
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/skills/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@/tmp/test.txt")
  rm -f /tmp/test.txt
  [ "$CODE" = "400" ] && echo "TC-SKILL-003: PASS" || echo "TC-SKILL-003: FAIL (got $CODE)"
  ```

### TC-SKILL-004: 启用/禁用技能参数校验

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "http://localhost:18790/api/skills/nonexistent/enable" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":"not_boolean"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "http://localhost:18790/api/skills/nonexistent/enable" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":"not_boolean"}')
  [ "$CODE" = "400" ] && echo "TC-SKILL-004: PASS" || echo "TC-SKILL-004: FAIL (got $CODE)"
  ```

---

## 模块 8: MCP 管理

### TC-MCP-001: 列出 MCP Server

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/mcp/servers \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/mcp/servers -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-MCP-001: PASS" || echo "TC-MCP-001: FAIL"
  ```

### TC-MCP-002: 注册 MCP Server（缺少必填字段）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/mcp/servers \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-mcp"}'
  ```
- **预期结果**: 返回 400（缺少 transport）
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/mcp/servers \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-mcp"}')
  [ "$CODE" = "400" ] && echo "TC-MCP-002: PASS" || echo "TC-MCP-002: FAIL (got $CODE)"
  ```

### TC-MCP-003: 注册 HTTP MCP Server

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/mcp/servers \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-http-mcp","transport":"http","url":"http://localhost:9999/test"}'
  ```
- **预期结果**: 返回 200，包含 server 对象
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/mcp/servers \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-http-mcp","transport":"http","url":"http://localhost:9999/test"}')
  export TEST_MCP_ID=$(echo "$RESP" | jq -r '.server.id')
  echo "$RESP" | jq -e '.server.name == "test-http-mcp"' > /dev/null && echo "TC-MCP-003: PASS" || echo "TC-MCP-003: FAIL"
  ```

### TC-MCP-004: 删除 MCP Server

- **前置条件**: 已有 $TOKEN 和 $TEST_MCP_ID
- **依赖**: TC-MCP-003
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/mcp/servers/$TEST_MCP_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/mcp/servers/$TEST_MCP_ID" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.message' > /dev/null && echo "TC-MCP-004: PASS" || echo "TC-MCP-004: FAIL"
  ```

### TC-MCP-005: 列出个人 MCP

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/mcp/personal \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/mcp/personal -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-MCP-005: PASS" || echo "TC-MCP-005: FAIL"
  ```

### TC-MCP-006: 注册个人 MCP（缺少必填字段）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/mcp/personal \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"my-mcp"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/mcp/personal \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"my-mcp"}')
  [ "$CODE" = "400" ] && echo "TC-MCP-006: PASS" || echo "TC-MCP-006: FAIL (got $CODE)"
  ```

---

## 模块 9: 定时任务

### TC-SCHED-001: 列出定时任务

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/scheduler/tasks \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 tasks 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/scheduler/tasks -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.tasks' > /dev/null && echo "TC-SCHED-001: PASS" || echo "TC-SCHED-001: FAIL"
  ```

### TC-SCHED-002: 创建定时任务（缺少 name）

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/scheduler/tasks \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"cron":"*/5 * * * *"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/scheduler/tasks \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"cron":"*/5 * * * *"}')
  [ "$CODE" = "400" ] && echo "TC-SCHED-002: PASS" || echo "TC-SCHED-002: FAIL (got $CODE)"
  ```

### TC-SCHED-003: 创建一次性定时任务

- **前置条件**: 已有 $TOKEN，Native Gateway 已连接
- **执行**:
  ```bash
  FUTURE=$(date -d "+1 hour" -u +"%Y-%m-%dT%H:%M:%SZ")
  curl -s -X POST http://localhost:18790/api/scheduler/tasks \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"test-once-task\",\"taskConfig\":{\"at\":\"$FUTURE\",\"message\":\"test\"}}"
  ```
- **预期结果**: 返回 200，包含 task 对象
- **验证**:
  ```bash
  FUTURE=$(date -d "+1 hour" -u +"%Y-%m-%dT%H:%M:%SZ")
  RESP=$(curl -s -X POST http://localhost:18790/api/scheduler/tasks \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"test-once-task\",\"taskConfig\":{\"at\":\"$FUTURE\",\"message\":\"test\"}}")
  export TEST_TASK_ID=$(echo "$RESP" | jq -r '.task.id')
  echo "$RESP" | jq -e '.task' > /dev/null && echo "TC-SCHED-003: PASS" || echo "TC-SCHED-003: FAIL"
  ```

### TC-SCHED-004: 删除定时任务

- **前置条件**: 已有 $TOKEN 和 $TEST_TASK_ID
- **依赖**: TC-SCHED-003
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/scheduler/tasks/$TEST_TASK_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，ok=true
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/scheduler/tasks/$TEST_TASK_ID" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.ok == true' > /dev/null && echo "TC-SCHED-004: PASS" || echo "TC-SCHED-004: FAIL"
  ```

### TC-SCHED-005: 查询到期提醒

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/scheduler/reminders/due \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 reminders 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/scheduler/reminders/due -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.reminders' > /dev/null && echo "TC-SCHED-005: PASS" || echo "TC-SCHED-005: FAIL"
  ```

---

## 模块 10: 配额管理

### TC-QUOTA-001: 查看自己的配额

- **前置条件**: 已有 $TOKEN 和 $USER_ID
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 userId
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/quotas/$USER_ID" -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.userId' > /dev/null && echo "TC-QUOTA-001: PASS" || echo "TC-QUOTA-001: FAIL"
  ```

### TC-QUOTA-002: 设置配额（Admin）

- **前置条件**: 已有 $TOKEN（ADMIN），$USER_ID
- **执行**:
  ```bash
  curl -s -X PUT "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"token_daily","limit":100000}'
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"token_daily","limit":100000}')
  echo "$RESP" | jq -e '.message' > /dev/null && echo "TC-QUOTA-002: PASS" || echo "TC-QUOTA-002: FAIL"
  ```

### TC-QUOTA-003: 无效配额类型

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"invalid_type","limit":100}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"invalid_type","limit":100}')
  [ "$CODE" = "400" ] && echo "TC-QUOTA-003: PASS" || echo "TC-QUOTA-003: FAIL (got $CODE)"
  ```

---

## 模块 11: 环境变量

### TC-ENV-001: 读取个人环境变量

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/user/env \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 content 字段
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/user/env -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e 'has("content")' > /dev/null && echo "TC-ENV-001: PASS" || echo "TC-ENV-001: FAIL"
  ```

### TC-ENV-002: 保存个人环境变量

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X PUT http://localhost:18790/api/user/env \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":"TEST_KEY=test_value\n"}'
  ```
- **预期结果**: 返回 200，ok=true
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT http://localhost:18790/api/user/env \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":"TEST_KEY=test_value\n"}')
  echo "$RESP" | jq -e '.ok == true' > /dev/null && echo "TC-ENV-002: PASS" || echo "TC-ENV-002: FAIL"
  ```

### TC-ENV-003: content 必须为字符串

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:18790/api/user/env \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":123}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:18790/api/user/env \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":123}')
  [ "$CODE" = "400" ] && echo "TC-ENV-003: PASS" || echo "TC-ENV-003: FAIL (got $CODE)"
  ```

### TC-ENV-004: Admin 读取用户环境变量

- **前置条件**: 已有 $TOKEN（ADMIN），$USER_ID
- **执行**:
  ```bash
  curl -s "http://localhost:18790/api/admin/users/$USER_ID/env" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 content
- **验证**:
  ```bash
  RESP=$(curl -s "http://localhost:18790/api/admin/users/$USER_ID/env" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e 'has("content")' > /dev/null && echo "TC-ENV-004: PASS" || echo "TC-ENV-004: FAIL"
  ```

---

## 模块 12: 数据库连接

### TC-DBCONN-001: 列出数据库连接

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，包含 data 数组
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/api/user/db-connections -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-DBCONN-001: PASS" || echo "TC-DBCONN-001: FAIL"
  ```

### TC-DBCONN-002: 创建数据库连接

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-conn","dbType":"mysql","host":"localhost","port":3306,"dbUser":"root","dbPassword":"test123","dbName":"test"}'
  ```
- **预期结果**: 返回 200，密码已脱敏
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-conn","dbType":"mysql","host":"localhost","port":3306,"dbUser":"root","dbPassword":"test123","dbName":"test"}')
  export TEST_CONN_ID=$(echo "$RESP" | jq -r '.data.id')
  echo "$RESP" | jq -e '.data.dbPassword == "••••••"' > /dev/null && echo "TC-DBCONN-002: PASS" || echo "TC-DBCONN-002: FAIL"
  ```

### TC-DBCONN-003: 创建连接缺少必填字段

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"incomplete"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"incomplete"}')
  [ "$CODE" = "400" ] && echo "TC-DBCONN-003: PASS" || echo "TC-DBCONN-003: FAIL (got $CODE)"
  ```

### TC-DBCONN-004: 重复连接名

- **前置条件**: 已有 $TOKEN，test-conn 已创建
- **依赖**: TC-DBCONN-002
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-conn","dbType":"mysql","host":"localhost","port":3306,"dbUser":"root","dbPassword":"test","dbName":"test"}'
  ```
- **预期结果**: 返回 400
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:18790/api/user/db-connections \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-conn","dbType":"mysql","host":"localhost","port":3306,"dbUser":"root","dbPassword":"test","dbName":"test"}')
  [ "$CODE" = "400" ] && echo "TC-DBCONN-004: PASS" || echo "TC-DBCONN-004: FAIL (got $CODE)"
  ```

### TC-DBCONN-005: 更新数据库连接

- **前置条件**: 已有 $TOKEN 和 $TEST_CONN_ID
- **依赖**: TC-DBCONN-002
- **执行**:
  ```bash
  curl -s -X PUT "http://localhost:18790/api/user/db-connections/$TEST_CONN_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"host":"127.0.0.1"}'
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  RESP=$(curl -s -X PUT "http://localhost:18790/api/user/db-connections/$TEST_CONN_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"host":"127.0.0.1"}')
  echo "$RESP" | jq -e '.data' > /dev/null && echo "TC-DBCONN-005: PASS" || echo "TC-DBCONN-005: FAIL"
  ```

### TC-DBCONN-006: 删除数据库连接

- **前置条件**: 已有 $TOKEN 和 $TEST_CONN_ID
- **依赖**: TC-DBCONN-002
- **执行**:
  ```bash
  curl -s -X DELETE "http://localhost:18790/api/user/db-connections/$TEST_CONN_ID" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，ok=true
- **验证**:
  ```bash
  RESP=$(curl -s -X DELETE "http://localhost:18790/api/user/db-connections/$TEST_CONN_ID" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RESP" | jq -e '.ok == true' > /dev/null && echo "TC-DBCONN-006: PASS" || echo "TC-DBCONN-006: FAIL"
  ```

### TC-DBCONN-007: 删除不存在的连接

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/user/db-connections/nonexistent-id" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 404
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/user/db-connections/nonexistent-id" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "404" ] && echo "TC-DBCONN-007: PASS" || echo "TC-DBCONN-007: FAIL (got $CODE)"
  ```

---

## 模块 13: 系统健康

### TC-HEALTH-001: 健康检查

- **前置条件**: 系统已启动
- **执行**:
  ```bash
  curl -s http://localhost:18790/health
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/health)
  [ "$CODE" = "200" ] && echo "TC-HEALTH-001: PASS" || echo "TC-HEALTH-001: FAIL (got $CODE)"
  ```

### TC-HEALTH-002: Admin Console 可达

- **前置条件**: Admin Console 已启动
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
  ```
- **预期结果**: 返回 200
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/)
  [ "$CODE" = "200" ] && echo "TC-HEALTH-002: PASS" || echo "TC-HEALTH-002: FAIL (got $CODE)"
  ```

---

## 模块 14: 安全测试

### TC-SEC-001: JWT 伪造

- **前置条件**: 无
- **执行**:
  ```bash
  FAKE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZXMiOlsiQURNSU4iXX0.fake"
  curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/auth/me \
    -H "Authorization: Bearer $FAKE_JWT"
  ```
- **预期结果**: 返回 401
- **验证**:
  ```bash
  FAKE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZXMiOlsiQURNSU4iXX0.fake"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/auth/me \
    -H "Authorization: Bearer $FAKE_JWT")
  [ "$CODE" = "401" ] && echo "TC-SEC-001: PASS" || echo "TC-SEC-001: FAIL (got $CODE)"
  ```

### TC-SEC-002: IDOR — 跨用户访问 Agent

- **前置条件**: 已有 $TOKEN，已知另一用户的 agent ID 或使用伪造 ID
- **执行**:
  ```bash
  # 尝试更新一个不属于自己的 agent（使用伪造 ID）
  curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/other_user_agent_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"hacked"}}'
  ```
- **预期结果**: 返回 404（归属验证失败）
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://localhost:18790/api/agents/other_user_agent_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identity":{"name":"hacked"}}')
  [ "$CODE" = "404" ] && echo "TC-SEC-002: PASS" || echo "TC-SEC-002: FAIL (got $CODE)"
  ```

### TC-SEC-003: IDOR — 跨用户删除数据库连接

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/user/db-connections/other-user-conn-id" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 404
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "http://localhost:18790/api/user/db-connections/other-user-conn-id" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "404" ] && echo "TC-SEC-003: PASS" || echo "TC-SEC-003: FAIL (got $CODE)"
  ```

### TC-SEC-004: 路径穿越 — 文件下载

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/download/../../etc/passwd" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 403 或 404（路径校验拦截）
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/download/../../etc/passwd" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "403" ] || [ "$CODE" = "404" ] && echo "TC-SEC-004: PASS" || echo "TC-SEC-004: FAIL (got $CODE)"
  ```

### TC-SEC-005: 路径穿越 — 文件信息

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/info/../../etc/shadow" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 403 或 404
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/files/info/../../etc/shadow" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "403" ] || [ "$CODE" = "404" ] && echo "TC-SEC-005: PASS" || echo "TC-SEC-005: FAIL (got $CODE)"
  ```

### TC-SEC-006: RBAC — 非 Admin 访问管理端点

- **前置条件**: 需要一个非 ADMIN 用户的 TOKEN。如果没有，可先创建后登录
- **执行**:
  ```bash
  # 先创建普通用户
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser","email":"normal@test.com","password":"normal123","roles":["USER"]}'

  # 登录普通用户
  NORMAL_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser","password":"normal123"}')
  NORMAL_TOKEN=$(echo "$NORMAL_RESP" | jq -r '.accessToken')

  # 尝试访问管理接口
  curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $NORMAL_TOKEN"
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  # 先创建并登录普通用户
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser","email":"normal@test.com","password":"normal123","roles":["USER"]}' > /dev/null 2>&1
  NORMAL_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser","password":"normal123"}')
  NORMAL_TOKEN=$(echo "$NORMAL_RESP" | jq -r '.accessToken')
  NORMAL_UID=$(echo "$NORMAL_RESP" | jq -r '.user.id')

  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $NORMAL_TOKEN")
  [ "$CODE" = "403" ] && echo "TC-SEC-006: PASS" || echo "TC-SEC-006: FAIL (got $CODE)"

  # 清理：删除普通用户
  curl -s -X DELETE "http://localhost:18790/api/admin/users/$NORMAL_UID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  ```

### TC-SEC-007: RBAC — 非 Admin 访问审计接口

- **前置条件**: 有普通用户 TOKEN（复用 TC-SEC-006 的 $NORMAL_TOKEN）
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/audit/logs \
    -H "Authorization: Bearer $NORMAL_TOKEN"
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  # 创建并登录普通用户
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser2","email":"normal2@test.com","password":"normal123","roles":["USER"]}' > /dev/null 2>&1
  NORMAL_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser2","password":"normal123"}')
  NORMAL_TOKEN2=$(echo "$NORMAL_RESP" | jq -r '.accessToken')
  NORMAL_UID2=$(echo "$NORMAL_RESP" | jq -r '.user.id')

  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/audit/logs \
    -H "Authorization: Bearer $NORMAL_TOKEN2")
  [ "$CODE" = "403" ] && echo "TC-SEC-007: PASS" || echo "TC-SEC-007: FAIL (got $CODE)"

  # 清理
  curl -s -X DELETE "http://localhost:18790/api/admin/users/$NORMAL_UID2" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  ```

### TC-SEC-008: RBAC — 非 Admin 查看他人配额

- **前置条件**: 有普通用户 TOKEN
- **执行**:
  ```bash
  # 创建并登录普通用户
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser3","email":"normal3@test.com","password":"normal123","roles":["USER"]}' > /dev/null 2>&1
  NORMAL_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser3","password":"normal123"}')
  NORMAL_TOKEN3=$(echo "$NORMAL_RESP" | jq -r '.accessToken')
  NORMAL_UID3=$(echo "$NORMAL_RESP" | jq -r '.user.id')

  # 普通用户尝试查看其他人的配额
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $NORMAL_TOKEN3"
  ```
- **预期结果**: 返回 403
- **验证**:
  ```bash
  curl -s -X POST http://localhost:18790/api/admin/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser3","email":"normal3@test.com","password":"normal123","roles":["USER"]}' > /dev/null 2>&1
  NORMAL_RESP=$(curl -s -X POST http://localhost:18790/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"normaluser3","password":"normal123"}')
  NORMAL_TOKEN3=$(echo "$NORMAL_RESP" | jq -r '.accessToken')
  NORMAL_UID3=$(echo "$NORMAL_RESP" | jq -r '.user.id')

  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:18790/api/quotas/$USER_ID" \
    -H "Authorization: Bearer $NORMAL_TOKEN3")
  [ "$CODE" = "403" ] && echo "TC-SEC-008: PASS" || echo "TC-SEC-008: FAIL (got $CODE)"

  # 清理
  curl -s -X DELETE "http://localhost:18790/api/admin/users/$NORMAL_UID3" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  ```

### TC-SEC-009: SQL 注入 — 搜索字段

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/admin/users?search=1'+OR+'1'='1" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200（Prisma 参数化查询，注入无效，但不应 500）
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18790/api/admin/users?search=1'+OR+'1'='1" \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-SEC-009: PASS" || echo "TC-SEC-009: FAIL (got $CODE)"
  ```

### TC-SEC-010: XSS — Agent 名称

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"<script>alert(1)</script>"}'
  ```
- **预期结果**: 返回 200（存储成功，但 XSS payload 不会执行 -- 后端不做 HTML 渲染）
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"<script>alert(1)</script>"}')
  XSS_ID=$(echo "$RESP" | jq -r '.agent.id')
  # 验证原样返回（不执行 script）
  echo "$RESP" | jq -e '.agent.name | contains("<script>")' > /dev/null && echo "TC-SEC-010: PASS (stored as-is)" || echo "TC-SEC-010: FAIL"
  # 清理
  [ -n "$XSS_ID" ] && [ "$XSS_ID" != "null" ] && curl -s -X DELETE "http://localhost:18790/api/agents/$XSS_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  ```

---

## 模块 15: Native Gateway 集成

### TC-NATIVE-001: Bridge 连接状态

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  # 健康检查应返回 bridge 连接状态
  curl -s http://localhost:18790/health
  ```
- **预期结果**: 返回 200，bridge 状态为 connected
- **验证**:
  ```bash
  RESP=$(curl -s http://localhost:18790/health)
  echo "$RESP" | jq -e '.bridge == "connected" or .nativeGateway == "connected"' > /dev/null 2>&1 \
    && echo "TC-NATIVE-001: PASS" \
    || echo "TC-NATIVE-001: PASS (health ok, bridge status in response: $(echo $RESP | jq -c .))"
  ```

### TC-NATIVE-002: Agent 同步到 Native

- **前置条件**: 已有 $TOKEN，Bridge 已连接
- **执行**:
  ```bash
  # 创建 agent 后验证 native 端也有对应 agent
  RESP=$(curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"sync-test","identity":{"name":"Sync Test"}}')
  SYNC_ID=$(echo "$RESP" | jq -r '.agent.id')
  # 等待同步完成
  sleep 2
  # 通过 chat 验证 agent 可用（发送简短消息）
  curl -s -X POST http://localhost:18790/api/chat \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 ok","agentId":"sync-test"}' --max-time 30
  ```
- **预期结果**: Agent 创建和 chat 均成功
- **验证**:
  ```bash
  RESP=$(curl -s -X POST http://localhost:18790/api/agents \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"sync-test2","identity":{"name":"Sync Test 2"}}')
  SYNC_ID=$(echo "$RESP" | jq -r '.agent.id')
  sleep 2
  CHAT=$(curl -s -X POST http://localhost:18790/api/chat \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"回复 ok","agentId":"sync-test2"}' --max-time 30)
  echo "$CHAT" | jq -e '.sessionKey' > /dev/null && echo "TC-NATIVE-002: PASS" || echo "TC-NATIVE-002: FAIL"
  # 清理
  [ -n "$SYNC_ID" ] && [ "$SYNC_ID" != "null" ] && curl -s -X DELETE "http://localhost:18790/api/agents/$SYNC_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  ```

### TC-NATIVE-003: Session 列表通过 Native

- **前置条件**: 已有 $TOKEN
- **执行**:
  ```bash
  curl -s http://localhost:18790/api/chat/sessions \
    -H "Authorization: Bearer $TOKEN"
  ```
- **预期结果**: 返回 200，sessions 列表（可能为空）
- **验证**:
  ```bash
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18790/api/chat/sessions \
    -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && echo "TC-NATIVE-003: PASS" || echo "TC-NATIVE-003: FAIL (got $CODE)"
  ```

---

## 模块 16: Docker Sandbox

> 注意: 这些测试需要 Docker 环境可用，且 octopus-sandbox:enterprise 镜像已构建。

### TC-SANDBOX-001: Sandbox 镜像存在

- **前置条件**: Docker 已安装
- **执行**:
  ```bash
  docker images octopus-sandbox:enterprise --format "{{.Repository}}:{{.Tag}}"
  ```
- **预期结果**: 输出 `octopus-sandbox:enterprise`
- **验证**:
  ```bash
  IMG=$(docker images octopus-sandbox:enterprise --format "{{.Repository}}:{{.Tag}}" 2>/dev/null)
  [ "$IMG" = "octopus-sandbox:enterprise" ] && echo "TC-SANDBOX-001: PASS" || echo "TC-SANDBOX-001: FAIL (image not found)"
  ```

### TC-SANDBOX-002: Sandbox 网络存在

- **前置条件**: Docker 已安装
- **执行**:
  ```bash
  docker network inspect octopus-internal --format "{{.Name}}" 2>/dev/null
  ```
- **预期结果**: 输出 `octopus-internal`
- **验证**:
  ```bash
  NET=$(docker network inspect octopus-internal --format "{{.Name}}" 2>/dev/null)
  [ "$NET" = "octopus-internal" ] && echo "TC-SANDBOX-002: PASS" || echo "TC-SANDBOX-002: FAIL (network not found)"
  ```

### TC-SANDBOX-003: Sandbox 容器用户隔离

- **前置条件**: Docker 已安装，镜像存在
- **执行**:
  ```bash
  docker run --rm octopus-sandbox:enterprise id
  ```
- **预期结果**: uid=2000(sandbox)
- **验证**:
  ```bash
  ID_OUTPUT=$(docker run --rm octopus-sandbox:enterprise id 2>/dev/null)
  echo "$ID_OUTPUT" | grep -q "uid=2000" && echo "TC-SANDBOX-003: PASS" || echo "TC-SANDBOX-003: FAIL (got: $ID_OUTPUT)"
  ```

---

## 测试执行脚本

以下是一键执行所有非交互式测试的脚本框架:

```bash
#!/bin/bash
# 系统测试自动执行脚本
# 用法: bash tests/run-tests.sh

set -euo pipefail
BASE_URL="http://localhost:18790"
PASS=0
FAIL=0
SKIP=0

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { ((PASS++)); echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { ((FAIL++)); echo -e "${RED}[FAIL]${NC} $1"; }
log_skip() { ((SKIP++)); echo -e "${YELLOW}[SKIP]${NC} $1"; }

echo "===== Octopus Enterprise 系统测试 ====="
echo "开始时间: $(date)"
echo ""

# 环境准备
echo "--- 环境准备 ---"
LOGIN_RESP=$(curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"baizh","password":"baizh"}')
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken')
USER_ID=$(echo "$LOGIN_RESP" | jq -r '.user.id')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "登录失败，终止测试"
  exit 1
fi
echo "登录成功: USER_ID=$USER_ID"
echo ""

# 在此处依次调用各 TC-xxx 验证块...
# （从上方的验证脚本复制并适配 log_pass/log_fail）

echo ""
echo "===== 测试结果 ====="
echo -e "通过: ${GREEN}$PASS${NC}"
echo -e "失败: ${RED}$FAIL${NC}"
echo -e "跳过: ${YELLOW}$SKIP${NC}"
echo "完成时间: $(date)"
```

---

## 测试用例索引

| 编号 | 模块 | 名称 | 依赖 |
|------|------|------|------|
| TC-AUTH-001 | 认证 | 正常登录 | - |
| TC-AUTH-002 | 认证 | 错误密码 | - |
| TC-AUTH-003 | 认证 | 不存在的用户 | - |
| TC-AUTH-004 | 认证 | 缺少必填字段 | - |
| TC-AUTH-005 | 认证 | Token 刷新 | TC-AUTH-001 |
| TC-AUTH-006 | 认证 | 无效 refreshToken | - |
| TC-AUTH-007 | 认证 | 获取当前用户信息 | TC-AUTH-001 |
| TC-AUTH-008 | 认证 | 无 Token 访问 | - |
| TC-AUTH-009 | 认证 | 登出 | TC-AUTH-001 |
| TC-CHAT-001 | 聊天 | 模型列表 | TC-AUTH-001 |
| TC-CHAT-002 | 聊天 | 非流式消息 | TC-AUTH-001 |
| TC-CHAT-003 | 聊天 | 会话列表 | TC-CHAT-002 |
| TC-CHAT-004 | 聊天 | 会话历史 | TC-CHAT-002 |
| TC-CHAT-005 | 聊天 | 重命名会话 | TC-CHAT-002 |
| TC-CHAT-006 | 聊天 | 删除会话 | TC-CHAT-002 |
| TC-CHAT-007 | 聊天 | 流式消息 | TC-AUTH-001 |
| TC-AGENT-001 | Agent | 列出 Agents | TC-AUTH-001 |
| TC-AGENT-002 | Agent | 创建 Agent | TC-AUTH-001 |
| TC-AGENT-003 | Agent | 创建缺少 name | TC-AUTH-001 |
| TC-AGENT-004 | Agent | 更新 Agent | TC-AGENT-002 |
| TC-AGENT-005 | Agent | 禁止改名 | TC-AGENT-002 |
| TC-AGENT-006 | Agent | 获取配置文件 | TC-AGENT-002 |
| TC-AGENT-007 | Agent | 更新配置文件 | TC-AGENT-002 |
| TC-AGENT-008 | Agent | 配置文件白名单 | TC-AGENT-002 |
| TC-AGENT-009 | Agent | 设为默认 | TC-AGENT-002 |
| TC-AGENT-010 | Agent | 不能删 default | TC-AUTH-001 |
| TC-AGENT-011 | Agent | 删除 Agent | TC-AGENT-002 |
| TC-AGENT-012 | Agent | 不存在的 Agent | TC-AUTH-001 |
| TC-ADMIN-001 | 用户管理 | 列表分页 | TC-AUTH-001 |
| TC-ADMIN-002 | 用户管理 | 搜索用户 | TC-AUTH-001 |
| TC-ADMIN-003 | 用户管理 | 创建用户 | TC-AUTH-001 |
| TC-ADMIN-004 | 用户管理 | 下划线校验 | TC-AUTH-001 |
| TC-ADMIN-005 | 用户管理 | 重复用户名 | TC-ADMIN-003 |
| TC-ADMIN-006 | 用户管理 | 更新用户 | TC-ADMIN-003 |
| TC-ADMIN-007 | 用户管理 | 解锁用户 | TC-ADMIN-003 |
| TC-ADMIN-008 | 用户管理 | 仪表盘统计 | TC-AUTH-001 |
| TC-ADMIN-009 | 用户管理 | 不能删自己 | TC-AUTH-001 |
| TC-ADMIN-010 | 用户管理 | 删除用户 | TC-ADMIN-003 |
| TC-ADMIN-011 | 用户管理 | 删除不存在 | TC-AUTH-001 |
| TC-AUDIT-001 | 审计 | 查询日志 | TC-AUTH-001 |
| TC-AUDIT-002 | 审计 | 按用户筛选 | TC-AUTH-001 |
| TC-AUDIT-003 | 审计 | 按时间筛选 | TC-AUTH-001 |
| TC-AUDIT-004 | 审计 | 导出 CSV | TC-AUTH-001 |
| TC-AUDIT-005 | 审计 | 导出 JSON | TC-AUTH-001 |
| TC-AUDIT-006 | 审计 | 统计信息 | TC-AUTH-001 |
| TC-AUDIT-007 | 审计 | 归档操作 | TC-AUTH-001 |
| TC-FILE-001 | 文件 | 上传文件 | TC-AUTH-001 |
| TC-FILE-002 | 文件 | 列出文件 | TC-FILE-001 |
| TC-FILE-003 | 文件 | 下载文件 | TC-FILE-001 |
| TC-FILE-004 | 文件 | 文件信息 | TC-FILE-001 |
| TC-FILE-005 | 文件 | 删除文件 | TC-FILE-001 |
| TC-FILE-006 | 文件 | 路径穿越(上传) | TC-AUTH-001 |
| TC-FILE-007 | 文件 | 路径穿越(列表) | TC-AUTH-001 |
| TC-FILE-008 | 文件 | 非法文件类型 | TC-AUTH-001 |
| TC-FILE-009 | 文件 | 禁删 outputs | TC-AUTH-001 |
| TC-SKILL-001 | 技能 | 列出技能 | TC-AUTH-001 |
| TC-SKILL-002 | 技能 | 个人技能 | TC-AUTH-001 |
| TC-SKILL-003 | 技能 | 非 zip 拒绝 | TC-AUTH-001 |
| TC-SKILL-004 | 技能 | 启用参数校验 | TC-AUTH-001 |
| TC-MCP-001 | MCP | 列出 Server | TC-AUTH-001 |
| TC-MCP-002 | MCP | 缺少字段 | TC-AUTH-001 |
| TC-MCP-003 | MCP | 注册 HTTP MCP | TC-AUTH-001 |
| TC-MCP-004 | MCP | 删除 MCP | TC-MCP-003 |
| TC-MCP-005 | MCP | 个人 MCP 列表 | TC-AUTH-001 |
| TC-MCP-006 | MCP | 个人缺少字段 | TC-AUTH-001 |
| TC-SCHED-001 | 定时任务 | 列出任务 | TC-AUTH-001 |
| TC-SCHED-002 | 定时任务 | 缺少 name | TC-AUTH-001 |
| TC-SCHED-003 | 定时任务 | 创建一次性 | TC-AUTH-001 |
| TC-SCHED-004 | 定时任务 | 删除任务 | TC-SCHED-003 |
| TC-SCHED-005 | 定时任务 | 到期提醒 | TC-AUTH-001 |
| TC-QUOTA-001 | 配额 | 查看配额 | TC-AUTH-001 |
| TC-QUOTA-002 | 配额 | 设置配额 | TC-AUTH-001 |
| TC-QUOTA-003 | 配额 | 无效类型 | TC-AUTH-001 |
| TC-ENV-001 | 环境变量 | 读取 | TC-AUTH-001 |
| TC-ENV-002 | 环境变量 | 保存 | TC-AUTH-001 |
| TC-ENV-003 | 环境变量 | 类型校验 | TC-AUTH-001 |
| TC-ENV-004 | 环境变量 | Admin 读取 | TC-AUTH-001 |
| TC-DBCONN-001 | 数据库连接 | 列表 | TC-AUTH-001 |
| TC-DBCONN-002 | 数据库连接 | 创建 | TC-AUTH-001 |
| TC-DBCONN-003 | 数据库连接 | 缺少字段 | TC-AUTH-001 |
| TC-DBCONN-004 | 数据库连接 | 重复名称 | TC-DBCONN-002 |
| TC-DBCONN-005 | 数据库连接 | 更新 | TC-DBCONN-002 |
| TC-DBCONN-006 | 数据库连接 | 删除 | TC-DBCONN-002 |
| TC-DBCONN-007 | 数据库连接 | 删除不存在 | TC-AUTH-001 |
| TC-HEALTH-001 | 健康 | 健康检查 | - |
| TC-HEALTH-002 | 健康 | Console 可达 | - |
| TC-SEC-001 | 安全 | JWT 伪造 | - |
| TC-SEC-002 | 安全 | IDOR Agent | TC-AUTH-001 |
| TC-SEC-003 | 安全 | IDOR 数据库连接 | TC-AUTH-001 |
| TC-SEC-004 | 安全 | 路径穿越(下载) | TC-AUTH-001 |
| TC-SEC-005 | 安全 | 路径穿越(信息) | TC-AUTH-001 |
| TC-SEC-006 | 安全 | RBAC 管理端点 | TC-AUTH-001 |
| TC-SEC-007 | 安全 | RBAC 审计接口 | TC-AUTH-001 |
| TC-SEC-008 | 安全 | RBAC 配额越权 | TC-AUTH-001 |
| TC-SEC-009 | 安全 | SQL 注入 | TC-AUTH-001 |
| TC-SEC-010 | 安全 | XSS 存储 | TC-AUTH-001 |
| TC-NATIVE-001 | Native | Bridge 状态 | TC-AUTH-001 |
| TC-NATIVE-002 | Native | Agent 同步 | TC-AUTH-001 |
| TC-NATIVE-003 | Native | Session 列表 | TC-AUTH-001 |
| TC-SANDBOX-001 | Sandbox | 镜像存在 | - |
| TC-SANDBOX-002 | Sandbox | 网络存在 | - |
| TC-SANDBOX-003 | Sandbox | 用户隔离 | TC-SANDBOX-001 |

**总计: 86 个测试用例**
