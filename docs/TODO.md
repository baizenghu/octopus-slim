# Octopus 企业版待办清单

> 最后更新：2026-03-28
> 已完成项见 `docs/refactor-history.md`

---

## P1 — 功能缺失

### 1. 提醒轮询优化

**状态：** 待开发

**需求：** 前端每 30s 轮询 `GET /api/scheduler/reminders/due`，需改为推送。

**方案：** 利用引擎原生 Cron `delivery.mode: announce`，完成后主动推送到 IM，消除前端轮询。需要验证引擎 announce 模式在企业架构下是否可用。

**预估工作量：** 需调研

---

## P2 — 代码优化

### 2. Markdown 渲染

**状态：** 待开发

**需求：** ChatMessages.tsx 当前将 AI 回复直接 `split('\n')` 渲染为纯文本段落，Markdown 格式全部丢失（表格、代码块、链接、列表、加粗等）。

**方案：** 引入 `react-markdown` + `remark-gfm`（表格/删除线） + `rehype-highlight`（代码高亮）。

**涉及文件：**
- 修改：`apps/console/src/pages/ChatMessages.tsx`（替换纯文本渲染为 Markdown 组件）
- 新增：`pnpm --filter console add react-markdown remark-gfm rehype-highlight`

**预估工作量：** 小

---

### 3. Tool Call 可视化

**状态：** 待开发

**需求：** agent 调用工具时（execute_command、read_file、mcp__*、run_skill 等），前端无任何展示。后端 SSE 已推送 `toolCall: true, tools: [event.toolName]` 数据（chat.ts:457），但前端未消费。

**效果：** 用户能看到 AI 在背后干了什么（工具名 + 参数摘要 + 结果预览），增加透明度和信任感。

**涉及文件：**
- 修改：`apps/console/src/pages/ChatPage.tsx`（SSE 解析增加 toolCall 处理）
- 修改：`apps/console/src/pages/ChatMessages.tsx`（新增工具调用卡片组件）

**预估工作量：** 中

---

### 4. 外部 Webhook 入口

**状态：** 待开发

**需求：** 提供 HTTP 接口让外部系统主动触发 agent 执行任务，将 agent 从"等人说话"变为"可被系统事件驱动"。

**典型场景：**
| 场景 | 触发方 | agent 做什么 |
|------|--------|------------|
| 监控报警 | Zabbix/Prometheus | 自动查日志、分析原因、发飞书告警摘要 |
| OA 审批通过 | OA 系统回调 | 自动生成合同/文档 |
| 代码合并 | GitLab webhook | 自动跑代码审查、生成变更说明 |
| 客户提工单 | 工单系统 | 自动查知识库、草拟回复 |

**API 设计：**
```
POST /api/webhook/agent
Headers: X-Webhook-Token: <独立token>
Body: { "message": "...", "agentId": "...", "userId": "...", "deliver": true }
```

**涉及文件：**
- 新增：`apps/server/src/routes/webhook.ts`
- 修改：`apps/server/src/index.ts`（挂载路由）
- 修改：`.env`（新增 WEBHOOK_TOKEN）

**注意事项：**
- Webhook token 独立于 JWT 和 Gateway token
- 需要 userId 参数来确定执行上下文（workspace、权限）
- deliver=true 时将结果发送到用户绑定的 IM
- 引擎 cron 已有 announce/webhook delivery 模式可复用

**预估工作量：** 中

---

### 5. 头像系统（Agent + 用户）

**状态：** 待开发

**需求：**
1. **Agent 头像**：引擎已支持 IDENTITY.md 的 `avatar` 字段，但企业层 AgentConfigSync 未写入该字段，前端 AgentsPage 无上传入口。
2. **用户头像**：用户目前无头像，聊天界面和用户管理只显示文字。

**涉及文件：**
- 修改：`apps/server/src/services/AgentConfigSync.ts`（写入 avatar 到 IDENTITY.md）
- 修改：`apps/server/src/routes/agents.ts`（接收 avatar 上传）
- 修改：`apps/server/src/routes/auth.ts`（用户头像上传/读取）
- 修改：`apps/console/src/pages/AgentsPage.tsx`（Agent 头像上传 UI）
- 修改：`apps/console/src/pages/PersonalSettingsPage.tsx`（用户头像上传 UI）
- 修改：`apps/console/src/pages/ChatMessages.tsx`（聊天气泡显示头像）
- 修改：`prisma/schema.prisma`（User 表增加 avatarPath 字段）

**存储方案：** 上传到 `{dataRoot}/avatars/{userId 或 agentId}/avatar.{ext}`，DB 存相对路径。

**预估工作量：** 中

---

## 待讨论

### 6. Skill Service — 远程执行能力

**状态：** 概念阶段，待讨论

**需求：** 部分用户有自己的服务器（GPU、大内存、特定硬件），Skill 可直接运行在用户服务器上，而非企业 Docker 沙箱。

**候选方案：**
| 方案 | 原理 | 复杂度 |
|------|------|--------|
| A. HTTP 回调 | Skill 配置 `serviceUrl`，Gateway POST 调用，等响应 | 小 |
| B. Runner 模式 | 用户部署轻量 Agent，长轮询拉取任务执行 | 中 |

**关键设计点：**
- Skill 增加 `executionMode: "local" | "docker" | "remote"`
- remote 模式：认证（token）、超时、健康检查、结果格式
- 与现有 `run_skill` 执行分支并列，改动集中

---

## 已知技术债（接受/排除）

| 问题 | 决策 | 原因 |
|------|------|------|
| API Key 明文在 git 中 | 接受 | 内网部署 |
| 飞书 /bind 密码明文 | 接受 | 飞书整体不动 |
| 企业 Skill 宿主机执行 | 接受 | 管理员信任 |
| MockLDAP 未去除 | 接受 | 认证重构风险高 |
