# Octopus 企业级 AI Agent 平台 — 技术深度解析报告

> 编制日期：2026-03-14

---

## 一、项目定位

Octopus 是一个**面向企业内网环境的多租户 AI Agent 协作平台**，将大语言模型从"聊天工具"升级为"具备长期记忆、工具调用、定时巡检、多渠道触达能力的智能工作助手"。

**核心价值主张**：
- 数据主权：全部数据留在企业内网，零数据出境
- 安全合规：六层纵深防御 + 双写审计
- 智能协作：多 Agent 协同 + 长期记忆 + 技能扩展
- 多渠道触达：Web + 邮箱 + 飞书 + 可扩展 IM 渠道

---

## 二、系统架构

### 2.1 三层分层架构

```
┌─────────────────────────────────────────────────┐
│  前端层 — React + shadcn/ui                      │
│  Chat Console (端口 3001)                        │
│  SSE 流式渲染 / 斜杠命令 / 内部标签过滤          │
└───────────────────┬─────────────────────────────┘
                    │ HTTP / SSE
                    ▼
┌─────────────────────────────────────────────────┐
│  企业网关层 — Express + TypeScript (端口 18790)   │
│  JWT 认证 │ RBAC │ 审计日志 │ 配额管理           │
│  Agent CRUD │ Skill 管理 │ MCP 管理 │ 调度器     │
│  IM 集成（飞书）│ 文件管理 │ 安全监控             │
└───────────────────┬─────────────────────────────┘
                    │ 进程内 RPC（零网络开销）
                    ▼
┌─────────────────────────────────────────────────┐
│  原生引擎层 — Octopus Native Gateway (端口 19791)│
│  Agent 推理引擎 │ Session 管理 │ Cron 调度       │
│  Plugin 系统 │ 工具执行 │ 配置热加载              │
└─────────────────────────────────────────────────┘
```

**设计亮点**：

| 特性 | 说明 |
|------|------|
| 关注点分离 | 企业治理（认证/审计/配额）与 AI 推理引擎完全解耦 |
| 零延迟通信 | EngineAdapter 在进程内直接调用原生引擎，无网络开销 |
| 可演进架构 | EngineAdapter 可无缝切换为 WebSocket RPC 分布式模式，支持水平扩展 |

### 2.2 用户命名空间隔离

```
Agent ID:    ent_{userId}_{agentName}
Session Key: agent:ent_{userId}_{agentName}:session:{uuid}
Workspace:   data/users/{userId}/workspace/
```

每个用户拥有完全隔离的 Agent 空间、会话空间、文件空间和记忆空间，从数据层面杜绝用户间信息泄露。

### 2.3 数据流全景

```
用户消息（Web / 飞书）
    │
    ├─ 认证（JWT 验证）
    ├─ 授权（RBAC + 工具白名单）
    ├─ 配额检查（Token / 请求数 / 存储空间）
    │
    ├─ 构建企业级上下文注入
    │   ├─ 用户身份信息
    │   ├─ 可用工具列表（MCP + Skill + DB 连接）
    │   └─ Agent 身份声明
    │
    ├─ 自动记忆回忆（before_agent_start Hook）
    │   └─ 向量 + BM25 混合检索 → 注入 <relevant-memories>
    │
    ├─ LLM 推理 + 工具调用
    │   ├─ MCP 工具（权限校验 → 执行）
    │   ├─ Skill 脚本（Docker 沙箱执行）
    │   ├─ 原生工具（文件/搜索/命令）
    │   └─ 数据库查询（连接白名单校验）
    │
    ├─ 自动记忆捕获（agent_end Hook）
    │   └─ LLM 分析对话 → 提取关键信息 → 分类存储
    │
    ├─ 审计日志双写（DB + JSONL）
    │
    └─ 响应净化 → SSE 流式推送 / IM 消息推送
```

---

## 三、安全性设计（六层纵深防御）

### 3.1 安全架构全景

| 防御层 | 机制 | 实现细节 |
|--------|------|----------|
| **网络层** | Docker iptables 隔离 | 容器封锁公网；额外封锁宿主机敏感端口（MySQL 3306 / Redis 6379 / Gateway 18790/19791） |
| **身份层** | JWT + LDAP | 双密钥体系（Access 2h + Refresh 7d）；弱密钥启动拒绝（长度/熵值/模式黑名单） |
| **授权层** | RBAC + 三级白名单 | 角色权限 → Agent 工具白名单（skillsFilter/mcpFilter/toolsFilter）→ 数据库连接白名单 |
| **执行层** | Docker 沙箱 | 每 Agent 独立容器；uid=2000（非宿主 uid）；资源限额（256MB 内存 / 0.5 CPU） |
| **审计层** | 双写审计 | MySQL（便于查询）+ JSONL 文件（容错）；30 天滚动保留 |
| **应急层** | 主动安全监控 | SecurityMonitor 实时检测暴力破解（1 分钟 10 次）/ 异常 API 请求模式（1 分钟 200 次） |

### 3.2 Docker 沙箱隔离（核心创新）

```
┌── 宿主机 (uid=1000, baizh) ──────────────────────────┐
│                                                        │
│  ┌── 容器 A: ent_userA_default ──────────────────┐    │
│  │  uid=2000 (sandbox)                           │    │
│  │  /workspace → bind mount userA workspace      │    │
│  │  /opt/skills → :ro 只读挂载                   │    │
│  │  网络: octopus-internal (172.30.0.0/16)       │    │
│  │  资源: 内存 256MB / CPU 0.5 核                │    │
│  └───────────────────────────────────────────────┘    │
│                                                        │
│  ┌── 容器 B: ent_userB_default ──────────────────┐    │
│  │  完全独立，互相不可见                          │    │
│  └───────────────────────────────────────────────┘    │
│                                                        │
│  iptables 规则:                                        │
│  ├─ FORWARD: REJECT 容器出站（封锁公网）              │
│  ├─ ACCEPT: 内网段 192.168/10/172.16                  │
│  └─ DOCKER-USER: REJECT 3306/6379/19791/18790         │
└────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- **uid 隔离**：容器用户 uid=2000，与宿主机 uid=1000 不同，bind mount 时无法穿透宿主权限
- **Skill 保护**：`/opt/skills` 宿主机权限 700（仅 baizh 可读），容器 uid=2000 不可读，企业技能仅通过原生引擎发现
- **SSRF 防护**：MCP URL 黑名单校验，拦截所有内网地址（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12 等）

### 3.3 工具权限三级白名单

```
第一级: RBAC 角色
    └─ ADMIN: 用户/Skill/MCP 管理
    └─ USER: 个人 Agent/Skill/MCP

第二级: Agent 级白名单
    ├─ skillsFilter: ["skill-A", "skill-B"]  → 仅可用指定 Skill
    ├─ mcpFilter: ["mcp-server-1"]           → 仅可用指定 MCP
    └─ toolsFilter: ["read_file", "write_file"]  → 仅可用指定原生工具

第三级: 数据库连接白名单
    └─ allowedConnections: ["prod-readonly"]  → SQL 工具仅可访问指定连接
```

### 3.4 密码学防护

| 场景 | 算法 | 细节 |
|------|------|------|
| 用户密码 | bcrypt (cost=12) | 启动时自动迁移旧明文密码 |
| JWT 签名 | HMAC-SHA256 | 双密钥体系，kid 支持密钥轮换 |
| 数据库连接密码 | AES-256-GCM | 认证加密，格式 `{iv}:{tag}:{ciphertext}` |
| 密钥强度校验 | 启动时检查 | 长度 ≥32 / 熵值 ≥10 字符种类 / 弱模式黑名单 |

---

## 四、记忆系统（核心创新）

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                  memory-lancedb-pro Plugin                   │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ 嵌入层    │  │ 混合检索层    │  │ 智能提取层             │ │
│  │ OpenAI API│  │ Vector+BM25  │  │ LLM 自动分类           │ │
│  │ LRU 缓存  │  │ RRF 融合     │  │ preference / fact     │ │
│  │ 智能分块  │  │ 跨编码器重排  │  │ decision / entity     │ │
│  └──────────┘  │ 时间衰减     │  └────────────────────────┘ │
│                └──────────────┘                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ 作用域管理│  │ 衰减引擎     │  │ 反思系统               │ │
│  │ 多级隔离  │  │ 半衰期模型   │  │ Agent 自学 + 经验总结  │ │
│  └──────────┘  │ 访问强化     │  └────────────────────────┘ │
│                └──────────────┘                              │
│  ┌──── LanceDB 向量数据库 ─────────────────────────────────┐ │
│  │  .octopus-state/memory/lancedb-pro/                     │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 混合检索管道（业界领先）

```
用户输入查询
    │
    ├─① 向量检索（语义相似度）──┐
    │                           ├─③ RRF 倒数秩融合
    ├─② BM25 全文检索（关键词）─┘
    │
    ├─④ 跨编码器重排序（Jina/SiliconFlow）
    │
    ├─⑤ 时间衰减调整
    │   score *= 0.5 + 0.5 × e^(-ageDays / halfLife)
    │
    ├─⑥ 新近性加成
    │   score *= 1 + weight × e^(-days / recencyHalfLife)
    │
    ├─⑦ 长度归一化（防止长文本垄断分数）
    │
    └─⑧ 硬阈值过滤 → 返回 Top-K 结果
```

**与普通 AI 的记忆对比**：

| 维度 | 普通 AI | Octopus 记忆系统 |
|------|---------|-----------------|
| 记忆时长 | 单次对话上下文 | 永久存储（LanceDB 向量数据库） |
| 检索方式 | 无 | Vector + BM25 混合检索 + 重排序 |
| 记忆分类 | 无 | LLM 自动分类（偏好/事实/决策/实体） |
| 生命周期 | 对话结束即丢失 | 时间衰减 + 访问强化 + 反思巩固 |
| 隔离性 | 无 | 多级作用域（global/user/agent/project） |
| 自我学习 | 无 | 反思系统：定期回顾 → 总结经验 → 存为反思记忆 |

### 4.3 自动化记忆生命周期

| 阶段 | 触发时机 | 动作 |
|------|---------|------|
| **自动回忆** | Agent 执行前（`before_agent_start` Hook） | 检索相关记忆 → 注入 `<relevant-memories>` 上下文块 |
| **自动捕获** | Agent 执行后（`agent_end` Hook） | LLM 分析对话 → 提取关键信息 → 分类存储 |
| **防重复注入** | 检索时 | 同一记忆距上次注入至少间隔 N 轮才能再注入 |
| **反思学习** | 定期触发 | Agent 回顾历史 → 总结经验教训 → 存为反思记忆 |
| **时间衰减** | 检索时实时计算 | 旧记忆逐渐降权，常访问记忆获得强化 |

### 4.4 多级作用域隔离

```
global            → 全局共享（系统级知识）
user:{userId}     → 用户级（跨 Agent 偏好和准则）
agent:{agentId}   → Agent 级（私有工作经验）
project:{id}      → 项目级（协作上下文）——已预留
```

---

## 五、Skill 技能系统

### 5.1 设计理念

Skill 是**"受控的能力扩展单元"** — 功能强大（支持任意 Python/Node.js/Shell 脚本），安全有保障（审批 + 扫描 + 沙箱）。

### 5.2 完整生命周期

```
上传 ZIP
    ↓
解压 → 解析 SKILL.md (YAML Frontmatter)
    ↓
依赖检测（packages/ / requirements.txt / node_modules/）
    ↓
安全扫描（SkillScanner）
    ↓
┌─ 企业 Skill → 管理员审批（pending → approved）
│
└─ 个人 Skill → 扫描通过自动激活
    ↓
注入 Agent 系统提示（SKILL.md 完整操作指南）
    ↓
Agent 调用 run_skill → Docker 沙箱执行
    ↓
输出文件追踪（GeneratedFile 表）→ 配额计量 → 自动过期清理
```

### 5.3 企业级 vs 个人 Skill

| 维度 | 企业级 Skill | 个人 Skill |
|------|-------------|-----------|
| 上传者 | 管理员 | 普通用户 |
| 审批流 | pending → admin 审批 → approved | 扫描通过自动激活 |
| 可见性 | 所有用户（受 Agent skillsFilter 白名单限制） | 仅上传者 |
| 存储位置 | `data/skills/{skillId}/` | `data/users/{userId}/workspace/skills/{skillId}/` |
| 执行环境 | Docker 沙箱（uid=2000） | Docker 沙箱（uid=2000） |

### 5.4 智能执行特性

- **SKILL.md 操作指南**：每个 Skill 包含详细的执行流程文档（Phase 1-4），自动注入 Agent 系统提示
- **记忆联动**：执行前自动 `memory_recall("技能名 经验教训")`，遇错自动 `memory_store`
- **依赖管理**：自动检测 `packages/`、`requirements.txt`、`node_modules/`，智能注入 PYTHONPATH
- **输出截断保护**：stdout/stderr 超过 5000 字符自动截断，防止 Agent 上下文爆炸

---

## 六、MCP 工具生态

### 6.1 MCP 桥接架构

```
MySQL MCPServer 表
    │
    ├─ scope=enterprise（管理员创建）
    │   └─ 宿主机直接执行
    │       ├─ stdio: spawn 子进程
    │       └─ http: HTTP/JSON-RPC 2.0
    │
    └─ scope=personal（用户创建）
        └─ Docker 沙箱执行
            ├─ --memory 256m --cpus 0.5
            ├─ --user 2000:2000
            └─ --network octopus-internal
    │
    ▼
api.registerTool() → 原生 Agent 工具系统
    │
    ▼
Agent 调用工具: mcp__{serverId}__{toolName}
```

### 6.2 权限控制架构

```
Agent 调用 MCP 工具
    │
    ├─① mcpFilter 白名单校验
    │   └─ Agent.mcpFilter 是否包含该 MCP Server？
    │
    ├─② 连接白名单校验（仅 SQL 类工具）
    │   └─ Agent.allowedConnections 是否包含该连接名？
    │
    └─③ 执行（企业 → 宿主机 / 个人 → Docker 沙箱）
```

### 6.3 用户级连接隔离

- 每个用户独占 MCP 连接 ID：`serverId::userId`
- 用户个人环境变量可注入 MCP 进程（数据库连接串等）
- 60 秒缓存权限查询结果，避免高频 DB 查询

---

## 七、Agent 架构

### 7.1 多 Agent 协作模型

```
用户消息
    ↓
Default Agent（通用助手）
    ├─ 分析需求领域
    ├─ 委派给 Specialist Agent
    │   ├─ 财务分析师 (ent_user_caiwu)
    │   ├─ PPT 生成器 (ent_user_ppt_generator)
    │   └─ 数据可视化专家 (ent_user_echarts)
    └─ 综合结果回复用户
```

- 每个用户拥有 1 个 Default Agent + N 个 Specialist Agent
- `subagents.allowAgents` 自动维护协作关系（Agent CRUD 时同步更新）
- 每个 Agent 拥有独立的系统提示、身份定义、记忆空间、工具权限

### 7.2 Agent 配置文件体系

| 文件 | 用途 | 生成方式 |
|------|------|---------|
| IDENTITY.md | 身份定义（名称、Emoji、角色） | 创建时生成 |
| SOUL.md | 行为准则（系统提示模板） | 模板 + 用户自定义 |
| TOOLS.md | 授权工具清单 | 动态生成（Skill + MCP + 原生工具） |
| MEMORY.md | 记忆规则铁律 | 模板初始化 |
| HEARTBEAT.md | 心跳巡检任务定义 | 管理员配置 |
| USER.md | 用户背景信息 | 可选配置 |
| AGENTS.md | 多 Agent 协作指南 | 自动生成 |

### 7.3 Agent 完整生命周期

```
创建 Agent
├─ DB 写入 Agent 记录
├─ 创建工作空间目录
├─ 原生引擎注册（agentsCreate RPC）
├─ 写入配置文件（IDENTITY.md / SOUL.md / MEMORY.md）
├─ 同步工具权限（TOOLS.md）
└─ 更新 Default Agent 的 subagents.allowAgents

运行 Agent
├─ 认证 + 归属校验
├─ 构建企业上下文注入
├─ 记忆回忆 + 注入
├─ LLM 推理 + 工具调用（沙箱执行）
├─ 记忆捕获
└─ 审计记录

删除 Agent
├─ 清理原生 cron 任务
├─ 删除 Docker 沙箱容器
├─ 级联删除 DB 关联记录
├─ 清理工作空间文件
├─ 更新其他 Agent 的 allowAgents 引用
└─ 从原生引擎注销
```

---

## 八、心跳巡检机制

### 8.1 多层心跳设计

| 层级 | 机制 | 频率 | 用途 |
|------|------|------|------|
| **SSE 连接保活** | `: heartbeat\n\n` 注释帧 | 每 15 秒 | 防止 SSE 连接超时断开 |
| **HTTP 健康检查** | GET `/health` | 启动时 / 按需 | 返回完整服务状态（数据库/Redis/插件/模型） |
| **进程监控** | start.sh PID 文件 | 启停时 | 优雅终止（SIGTERM）+ 5 秒超时强杀（SIGKILL） |
| **AI 智能巡检** | Agent 执行 HEARTBEAT.md | cron 表达式 | 定期智能检查，发现异常主动推送 |

### 8.2 AI 智能巡检（创新亮点）

不同于传统的 ping/pong 心跳，Octopus 的心跳巡检由 **AI Agent 执行**：

```
定时触发（cron 表达式）
    ↓
原生引擎加载 HEARTBEAT.md（巡检任务定义）
    ↓
Agent 执行巡检
├─ 检查 inbox 未读消息
├─ 检查 24 小时内日程
├─ 检查系统告警
├─ 执行自定义检查项
    ↓
├─ 正常 → 返回 "HEARTBEAT_OK"（静默）
└─ 异常 → 调用 send_im_message → 飞书推送通知管理员
```

### 8.3 健康检查响应示例

```json
{
  "status": "ok",
  "nativeGateway": "running",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "nativeGateway": "running",
    "database": "connected",
    "redis": "ok",
    "mockLdap": true
  },
  "plugins": {
    "enterprise-audit": "loaded",
    "enterprise-mcp": "loaded",
    "memory-lancedb-pro": "loaded"
  },
  "model": "deepseek-chat"
}
```

---

## 九、IM 即时通讯集成

### 9.1 多渠道适配器架构

```
┌─ FeishuAdapter（飞书）─── WebSocket 长连接
│   ├─ 消息接收（去重 LRU 1000 条）
│   ├─ 超长分段（2000 字符自动拆分）
│   └─ 消息撤回（绑定时自动删除含密码消息）
│
├─ [WangXunTongAdapter] ── 预留接口
├─ [DingTalkAdapter]    ── 预留接口
│
└─ IMAdapter 通用接口
    │
    ▼
IMRouter（消息路由）
├─ /bind username password → 绑定企业账户
├─ /unbind → 解除绑定
├─ /status → 查看绑定状态
└─ 普通消息 → callAgent → 等待回复 → 推送到用户
```

### 9.2 双向通信

**用户 → Agent**（主动对话）：
```
飞书私聊消息 → FeishuAdapter → IMRouter 查找绑定
    → callAgent(sessionKey = im-feishu-{openId})
    → Agent 执行 → 回复推送到飞书
```

**Agent → 用户**（主动通知）：
```
Agent 调用 send_im_message 工具
    → HTTP POST /api/_internal/im/send（内部 API + Token 认证）
    → IMService.sendToUser(userId, text)
    → 查询所有 IM 绑定 → 遍历发送
```

### 9.3 扩展新渠道

增加新 IM 渠道只需三步：
1. 实现 `IMAdapter` 接口（`start/stop/sendText/onMessage`）
2. 在 `IMService.start()` 中检查环境变量并启动
3. `IMRouter` 自动路由，**无需修改任何路由代码**

---

## 十、Plugin 系统

### 10.1 微内核架构

```
原生引擎 Plugin API
    │
    ├─ 24+ Lifecycle Hooks
    │   ├─ before_agent_start / agent_end
    │   ├─ tool:call / tool:call:result
    │   ├─ llm:response
    │   ├─ session:create / session:end
    │   └─ gateway_stop
    │
    ├─ api.registerTool() — 注册自定义工具
    ├─ api.resolvePath() — 路径解析
    └─ api.getConfig() — 读取 Plugin 配置
```

### 10.2 已实现 Plugin

| Plugin | 功能 | 关键特性 |
|--------|------|---------|
| **enterprise-audit** | 审计日志 | 20+ Hook 双写（DB + JSONL）；按日期分割；30 天滚动保留 |
| **enterprise-mcp** | MCP 工具桥接 | DB 注册 → 工具发现 → 权限校验 → 沙箱执行 |
| **memory-lancedb-pro** | 长期记忆 | 向量数据库 + 混合检索 + 时间衰减 + 反思学习 |

### 10.3 配置热加载

```
ConfigBatcher（2 秒批处理窗口）
    ↓
config.set RPC（智能评估）
    ├─ agents.* 变更 → 热加载（不重启）
    └─ plugins.* 变更 → 仅在必要时重启
```

---

## 十一、与普通 AI 工具全面对比

| 维度 | 普通 AI 聊天工具 | Octopus 企业平台 | 优势程度 |
|------|----------------|-----------------|---------|
| **部署模式** | SaaS 云端，数据出境 | 企业内网私有化，零出境 | ★★★★★ |
| **用户隔离** | 账号级别（逻辑隔离） | 三层物理隔离（FS+容器+网络） | ★★★★★ |
| **安全防护** | 依赖厂商策略 | 六层纵深防御 + 主动安全监控 | ★★★★★ |
| **记忆能力** | 无 / 有限上下文窗口 | 向量 DB 永久记忆 + 混合检索 + 反思学习 | ★★★★★ |
| **工具扩展** | 预定义工具集 | Plugin + MCP + Skill 三层递进式扩展 | ★★★★★ |
| **代码执行** | 无 / 受限沙箱 | Docker 完整沙箱（Python/Node/Shell） | ★★★★☆ |
| **多 Agent** | 单一助手 | Default + Specialist 委派协作 | ★★★★☆ |
| **IM 集成** | 无 | 飞书双向集成，可扩展多渠道 | ★★★★☆ |
| **定时任务** | 无 | AI 智能巡检 + cron 定时调度 | ★★★★☆ |
| **审计合规** | 日志不可控 | 双写审计 + RBAC + 操作追溯 | ★★★★★ |
| **配额管理** | 按账号计费 | 精细化配额（日/月 Token + 小时请求数 + 存储空间） | ★★★★☆ |
| **文件管理** | 临时文件 | 全生命周期追踪（创建→过期→清理）+ 配额 | ★★★★☆ |

---

## 十二、创新性总结

### 12.1 技术创新

| 序号 | 创新点 | 说明 |
|------|--------|------|
| 1 | **企业级 AI Agent 全栈平台** | 从认证、授权、审计到 Agent 推理、记忆、工具调用的完整闭环 |
| 2 | **三层安全沙箱** | 文件系统隔离 + Docker 容器隔离 + 网络隔离，物理级别防护 |
| 3 | **混合检索记忆系统** | Vector + BM25 + RRF 融合 + 时间衰减 + 反思学习，业界领先 |
| 4 | **Skill 可编程扩展** | ZIP 打包上传、安全扫描、管理员审批、沙箱执行的完整工作流 |
| 5 | **AI 智能巡检** | 心跳不再是简单 ping，而是 Agent 主动分析 + 飞书推送 |

### 12.2 架构创新

| 序号 | 创新点 | 说明 |
|------|--------|------|
| 1 | **进程内 RPC → 分布式无缝切换** | EngineAdapter 零成本切换为 WebSocket RPC 分布式部署 |
| 2 | **ConfigBatcher 配置批处理** | 2 秒窗口内配置变更自动合并，避免频繁重启 |
| 3 | **config.set 智能热加载** | Agent 配置变更热加载，Plugin 配置变更才重启 |
| 4 | **Plugin Hook 生态** | 24+ 生命周期钩子，企业功能以 Plugin 形式无侵入集成 |

### 12.3 工程创新

| 序号 | 创新点 | 说明 |
|------|--------|------|
| 1 | **Lessons Learned 持续积累** | 26 条踩坑记录，每次犯错即刻建立防线，持续自我迭代 |
| 2 | **双写审计** | DB（便于查询）+ JSONL 文件（容错），任一故障不丢数据 |
| 3 | **后消费配额模式** | 请求失败不扣费，请求成功后才计量，公平计费 |

---

## 十三、前瞻性与可扩展性

### 13.1 架构演进路径

```
Phase 1（当前）: 单机部署，进程内引擎
    ↓  EngineAdapter → OctopusBridge（改类名即切换）
Phase 2: 引擎分离，WebSocket RPC 分布式
    ↓  添加 Redis 状态同步
Phase 3: 多引擎实例，水平扩展
    ↓  添加模型路由层
Phase 4: 多模型智能路由（DeepSeek/Claude/GPT 按场景切换）
```

### 13.2 可扩展性矩阵

| 扩展方向 | 扩展方式 | 改动量 |
|---------|---------|--------|
| 新 IM 渠道 | 实现 `IMAdapter` 接口 + 环境变量 | 1 个文件 |
| 新 Plugin | 利用 24+ Hook 点编写 Plugin | 1 个目录 |
| 新 MCP 工具 | DB 注册 + `api.registerTool()` | 零代码 |
| 新 Skill | ZIP 上传，管理员审批 | 零代码 |
| 新模型提供商 | `compat` 字段适配 API 差异 | 配置级 |
| 新审计规则 | 在 enterprise-audit Plugin 添加 Hook | 几行代码 |

### 13.3 技术储备

- **多模型兼容**：`compat` 配置已支持 DeepSeek / Claude / GPT 等多提供商的 API 差异适配
- **多作用域记忆**：已预留 `project:` 级别作用域，可支撑未来项目级知识管理
- **文件生命周期管理**：GeneratedFile 全流程追踪（创建→过期→清理），存储可量化

---

## 十四、数据模型

### 14.1 核心表（12 张）

```
User                 → 用户（角色、配额、部门）
Agent                → AI Agent 定义（权限过滤器）
AuditLog             → 审计日志（双写 DB）
UserSession          → 浏览器会话（Token 管理）
Skill                → 技能（企业/个人作用域）
MCPServer            → MCP 服务（stdio/http）
DatabaseConnection   → 数据库连接（加密密码）
ScheduledTask        → 定时任务（心跳/cron）
GeneratedFile        → 生成文件（生命周期追踪）
IMUserBinding        → IM 用户绑定
IMChannel            → IM 通道配置
MailLog              → 邮件投递记录
```

### 14.2 关键索引

```sql
-- 审计查询加速
INDEX (userId, action, createdAt)  -- 复合索引

-- Agent 权限查询
INDEX (ownerId)

-- Skill/MCP 作用域过滤
INDEX (scope)
INDEX (ownerId)
```

---

## 十五、关键技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + shadcn/ui + Zustand + Vite |
| 企业网关 | Express + TypeScript + Prisma v6 + MySQL + Redis |
| 原生引擎 | Octopus Native Gateway（Node.js） |
| 向量数据库 | LanceDB（嵌入式，零运维） |
| 沙箱 | Docker（Ubuntu 22.04 + Python 3.11 + Node.js 20） |
| 认证 | JWT + LDAP（支持 MockLDAP 开发模式） |
| IM | 飞书 SDK（WebSocket 长连接） |
| AI 模型 | DeepSeek（通过内网代理）/ Claude（可选） |

---

> **一句话总结**：Octopus 不是一个 AI 聊天工具，而是一个**具备长期记忆、安全沙箱、多 Agent 协作、多渠道触达能力的企业级 AI 智能体平台**，在安全隔离、记忆系统、可扩展性等方面达到了生产级水准。
