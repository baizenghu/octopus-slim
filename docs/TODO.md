# Octopus 企业版待办清单

> 整改三阶段已完成（2026-03-17~18），以下为遗留待开发项。
> 按优先级排列，每项标注当前状态、改动范围和预估工作量。

---

## P0 — 系统运维入口

### 1. SystemConfigPage 系统配置管理页面 ✅

**状态：** 已完成（2026-03-18，commit a8fbfb1）

**需求：** 管理员通过前端维护 octopus.json 核心配置，替代手动编辑文件+重启。

**需支持的配置项：**
| 配置项 | 路径 | 当前维护方式 |
|--------|------|-------------|
| 模型配置 | `models.providers` | 手动编辑 |
| Sandbox 参数 | `agents.defaults.sandbox` | 手动编辑 |
| Skills 加载目录 | `skills.load.extraDirs` | 手动编辑 |
| 工具限制 | `tools.loopDetection` / `tools.fs` | 手动编辑 |
| 插件启用/禁用 | `plugins.allow` / `plugins.entries` | 手动编辑 |
| 心跳默认配置 | `agents.defaults.heartbeat` | 手动编辑 |

**涉及文件：**
- 恢复：`apps/console/src/pages/SystemConfigPage.tsx`（stash WIP）
- 恢复：`apps/server/src/routes/system-config.ts`（stash WIP）
- 修改：`apps/console/src/pages/SettingsPage.tsx`（添加管理员菜单入口）
- 修改：`apps/console/src/api.ts`（添加 config API 方法）
- 修改：`apps/server/src/index.ts`（挂载 system-config 路由）

**后端 API 设计：**
```
GET  /api/admin/config              — 读取完整配置
GET  /api/admin/config/:section     — 读取指定配置段（models/plugins/tools 等）
PUT  /api/admin/config/:section     — 更新指定配置段
```

**注意事项：**
- 使用 `bridge.configApply()`（deep merge）更新非数组字段
- 涉及 `agents.list` 的操作保持 read-modify-write 模式
- 页面顶部加提示："此页面是系统配置的唯一管理入口"
- 保存前对比 diff，无变化不写入

**预估工作量：** 中（stash 有基础，需评估补齐多少）

---

### 2. Plugin 配置 UI ✅

**状态：** 已完成（合并在 #1 中，SystemConfigPlugins.tsx）

**需求：** 前端管理插件配置参数（当前只能手动编辑 octopus.json `plugins.entries`）。

**需支持的插件：**
| 插件 | 关键配置项 |
|------|-----------|
| memory-lancedb-pro | embedding 模型、retrieval 参数、scopes/agentAccess |
| enterprise-audit | 日志目录、保留天数 |
| enterprise-mcp | 数据库连接、沙箱参数 |

**方案：** 集成到 SystemConfigPage 的 "插件" Tab，读写 `plugins.entries.*`。

**预估工作量：** 中（可与 SystemConfigPage 合并实现）

---

## P1 — 功能缺失

### 3. 个人 Skill 依赖自动安装 ✅

**状态：** 已完成（2026-03-18，commit 078c0dd）。上传时自动 pip install --target packages/，执行时容错补装。

**方案：**
```
上传时（skills.ts）：
  解压 zip → 检测 requirements.txt
  → pip install --target {skillDir}/packages --quiet
  → 入库

执行时（index.ts executeSkillInDocker）：
  -v ${skillPath}:/skill:ro  （packages/ 包含在内）
  -e PYTHONPATH=/skill/packages
```

**涉及文件：**
- `apps/server/src/routes/skills.ts` — 上传后自动安装
- `plugins/mcp/src/index.ts` — 执行时设 PYTHONPATH

**注意事项：**
- `pip install --target` 不依赖 venv，避免 Python 版本问题
- 安装超时建议 300s（大包如 pandas）
- Node.js skill 同理：检测 `package.json` → `npm install --production`

**预估工作量：** 小

---

### 4. skills.entries 双写同步 ✅

**状态：** 已完成（2026-03-18，commit 393d938）。引擎原生支持 `skills.entries[id].enabled`，在 approve/reject/enable 时调用 `configApply` 同步。

**前置确认：** 验证引擎是否支持通过配置控制单个 Skill 启用/禁用。如不支持，可能需要通过删除/恢复 `extraDirs` 中的文件实现。

**预估工作量：** 需调研

---

## P2 — 代码优化

### 5. ChatPage.tsx 前端拆分 ✅

**状态：** 已完成（2026-03-18，commit 2f76aad）。1249→561 行，拆出 SessionSidebar/ChatMessages/ChatInput。

**拆分方案：**
| 拆出组件 | 内容 | 预估行数 |
|---------|------|---------|
| `ChatMessages.tsx` | 消息列表渲染、滚动、thinking 展示 | ~300 |
| `ChatInput.tsx` | 输入框、附件上传、发送逻辑 | ~200 |
| `DelegationPoller.tsx` | 委派轮询逻辑（独立 hook） | ~100 |
| `SessionSidebar.tsx` | 会话列表、搜索、重命名、删除 | ~200 |

ChatPage.tsx 保留为容器组件（~400 行），组装上述子组件。

**预估工作量：** 中

---

### 6. ensureNativeAgent / syncToNative 合并 ✅

**状态：** 已完成（2026-03-18，commit 2f76aad）。统一到 AgentConfigSync.ensureAndSyncNativeAgent()，减少 89 行重复。原两套逻辑共存：
- `chat.ts:206` — `ensureNativeAgent()`（对话时 lazy 创建，有缓存 + 轮询就绪）
- `agents.ts:47` — `syncToNative()`（CRUD 时主动同步，写 IDENTITY/SOUL/MEMORY.md，3 次重试）

**方案：** 合并到 `AgentConfigSync.ts` 的 `ensureAndSyncNativeAgent()` 函数，参数化区分调用场景。

**涉及文件：**
- `apps/server/src/services/AgentConfigSync.ts` — 新增合并函数
- `apps/server/src/routes/chat.ts` — 替换 ensureNativeAgent
- `apps/server/src/routes/agents.ts` — 替换 syncToNative

**预估工作量：** 小

---

### 7. 提醒轮询优化

**状态：** 前端每 30s 轮询 `GET /api/scheduler/reminders/due`。

**方案：** 利用引擎原生 Cron `delivery.mode: announce`，完成后主动推送到 IM，消除前端轮询。需要验证引擎 announce 模式在企业架构下是否可用。

**预估工作量：** 需调研

---

### 8. 企业 Skill per-skill 依赖隔离（已关闭）

**状态：** 不再需要。#3 已统一为共享 venv + deps/*.whl 方案，企业和个人 Skill 共用 `data/skills/.venv/`。等出现实际版本冲突再评估。

---

## 待讨论

### 9. Skill Service — 远程执行能力

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

---

## 开发顺序建议

```
✅ 已完成：#1 #2 #3 #5 #6
剩余：#4 skills.entries（需调研） + #7 提醒优化（需调研） + #8 per-skill 隔离（等触发）
待讨论：#9 Skill Service 远程执行
```
