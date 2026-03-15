# IM Agent 切换功能设计

## 概述

允许 IM（飞书/Telegram）用户通过 `/agent <名称>` 指令切换到专业 agent 持续对话，`/agent default` 切回主 agent。每个 agent 维持独立会话，切换后所有后续消息路由到选中的 agent。

## 核心改动

### 文件范围

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/server/src/services/im/IMRouter.ts` | 修改 | 新增 `/agent` 指令处理、activeAgents Map、routeToAgent 动态路由 |

### 数据结构

进程级 Map 记录每个 IM 用户当前选择的 agent：

```typescript
// key: `${channel}:${imUserId}`, value: agentName
private activeAgents = new Map<string, string>();
```

选择进程级 Map 而非 DB 存储，理由：
- 重启后回落到 default 是合理的安全默认行为
- 无需 schema 迁移
- 读写性能最优

### 新增指令

在 `handleMessage()` 的 switch 中新增：

| 指令 | 行为 |
|------|------|
| `/agent <名称>` | 查 DB 验证 agent 存在且属于该用户 → 切换 → 回复确认 |
| `/agent` (无参数) | 显示当前选中的 agent 名称 |

### `/agent <名称>` 处理流程

```
1. 解析指令参数，提取 agentName
2. 通过 IM binding 查 userId（复用已有逻辑，在 handleMessage 中已查到 binding）
3. 查 DB：prisma.agent.findFirst({
     where: { ownerId: userId（通过binding.userId关联）, name: agentName, enabled: true }
   })
   - 注意：需要先通过 userId 查 user.id（prisma User 的主键），因为 agent.ownerId 关联的是 User.id
   - 或者 agentName === 'default' 时直接允许（default agent 不一定在 Agent 表中）
4. 不存在 → 列出该用户可用 agent，回复提示
5. 存在 → ensureAgent(userId, agentName) 确保 native agent 已创建
6. 更新 activeAgents Map：key = `${channel}:${imUserId}`, value = agentName
7. 回复 "已切换到 <agentDisplayName>"
```

### routeToAgent 改动

当前硬编码：
```typescript
const agentName = 'default';
```

改为从 Map 读取：
```typescript
const imKey = `${msg.channel}:${msg.imUserId}`;
const agentName = this.activeAgents.get(imKey) || 'default';
```

### Session 隔离

每个 agent 使用独立 session key，无需额外改动：
```
agent:ent_{userId}_{agentName}:session:im-{channel}-{imUserId}
```

切换 agent 后对话历史自动隔离（agentName 不同 → sessionKey 不同）。

### extraSystemPrompt 动态适配

专业 agent 有独立 workspace（`data/users/{userId}/agents/{agentName}/workspace/`），需要根据当前 agentName 动态获取路径：

- default agent → `workspaceManager.getSubPath(userId, 'WORKSPACE')` 等
- 专业 agent → 需使用 agent 专属 workspace 路径

当前 `getSubPath` 只支持 default agent 的路径。对于专业 agent，workspace 路径是 `data/users/{userId}/agents/{agentName}/workspace/`，需要直接拼接或扩展 workspaceManager。

简单方案：当 agentName !== 'default' 时，从 `dataRoot` 直接拼接路径：
```typescript
const base = agentName === 'default'
  ? workspaceManager.getSubPath(userId, 'WORKSPACE')
  : path.join(dataRoot, 'users', userId, 'agents', agentName, 'workspace');
```

### outputs 目录适配

`routeToAgent()` 中的 `outputsDir`（用于检测新文件并发送到 IM）也需要跟着 agentName 变化：

```typescript
const outputsDir = this.dataRoot
  ? (agentName === 'default'
      ? path.join(this.dataRoot, 'users', userId, 'workspace', 'outputs')
      : path.join(this.dataRoot, 'users', userId, 'agents', agentName, 'workspace', 'outputs'))
  : '';
```

## 边界情况

| 情况 | 处理 |
|------|------|
| agent 被删除/禁用后用户继续发消息 | native gateway 报错 → catch 块回复错误 → 用户手动 `/agent default` 切回 |
| 服务重启 | Map 清空，所有用户自动回落到 default |
| 用户未绑定就发 `/agent` | 走现有未绑定提示逻辑（`/agent` 在 binding 查询之前的 switch 中不处理，需放到 binding 查询之后） |

### 指令处理位置

`/agent` 指令需要知道 userId（查 agent 权限），所以不能放在 binding 查询之前的 switch 中。改为在 binding 查询之后、routeToAgent 之前单独判断：

```typescript
// 已有 binding，检查 /agent 指令
if (text.startsWith('/agent')) {
  await this.handleAgentSwitch(adapter, msg, binding.userId);
  return;
}
```

## 不做的事

- 不做 `/ask <agent> <问题>` 单次转发（后续可加）
- 不持久化 agent 选择到 DB（进程重启回落 default 是安全默认）
- 不改 IMService、IMAdapter 接口
- 不改 EngineAdapter 接口
