# 企业 Agent 记忆系统改造计划

## 背景
Octopus 目前有两套记忆系统并存：
1. **本地文件记忆**：MEMORY.md + memory/*.md（引擎原生，agent 主动读写）
2. **memory-lancedb-pro**：向量数据库记忆（插件，自动提取+语义搜索）

对企业 agent 来说，用户不会手动维护 MEMORY.md，两套并存浪费 context window 且易不一致。

## 目标
企业 agent 只用 lancedb-pro，移除本地文件记忆的创建和注入。

## 改造范围

### Phase 1: 停止为企业 agent 创建 MEMORY.md（低风险）
**文件：`apps/server/src/services/AgentConfigSync.ts`**
- `syncAgentToEngine()` 中不再调用 `agentFilesSet('MEMORY.md', ...)`（第498-559行区域）
- 保留 SOUL.md 和 IDENTITY.md 的创建逻辑

**文件：`apps/server/src/services/SoulTemplate.ts`**
- `getMemoryTemplate()` 保留但标记 deprecated（其他地方可能引用）

### Phase 2: 保留 memory_search/memory_get 工具（lancedb-pro 依赖）
**重要发现**：lancedb-pro 不提供独立工具，而是增强引擎原生 memory_search/memory_get 的后端存储。
- **不能禁用** memory_search/memory_get，否则 lancedb-pro 也废了
- 只需要停止往 workspace 写 MEMORY.md，让 lancedb-pro 的向量库成为唯一数据源
- memory_search 会自动搜索 lancedb-pro 的向量库而非文件

### Phase 3: 清理 AGENTS.md 模板中的记忆相关指引（低风险）
**文件：`docs/reference/templates/AGENTS.md`（企业版模板）**
- 移除"Memory"、"Session Startup 读 MEMORY.md"等段落
- 保留 lancedb-pro 会自动记忆的说明

### Phase 4: 引擎配置调整（低风险）
**在 `AgentConfigSync` 同步配置时**：
- 设置 `memory.enabled: false` 或 `memory.autoIndex: false`（禁用引擎原生 memory indexing）
- 让 lancedb-pro 插件独占记忆功能

## 不改的部分
- 引擎层 memory 工具代码不动（其他场景仍需要）
- lancedb-pro 插件配置不动
- 私人管家型 agent（如贾维斯）保持现有双记忆模式

## 验证
1. 新建企业 agent → 确认不生成 MEMORY.md
2. 对话中提问历史信息 → 确认 lancedb-pro 能正确召回
3. 检查 context window 占用是否减少
4. 已有 agent 的 MEMORY.md 不主动删除（向后兼容）

## 风险
- memory_search/memory_get 被禁后，如果 lancedb-pro 的记忆工具不够好，agent 可能丢失记忆能力
- 需要先确认 lancedb-pro 的工具名和调用方式，确保不会误伤
