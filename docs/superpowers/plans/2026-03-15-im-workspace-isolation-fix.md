# IM 工作区隔离漏洞修复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复通过 IM 聊天可以访问用户工作空间以外文件系统的安全漏洞

**Architecture:** 两层防御——① 在 `octopus.json` 全局配置 `tools.fs.workspaceOnly: true`，从引擎层面硬限制 fs 工具只能操作 workspace 目录；② 在 `IMRouter.routeToAgent()` 注入 `extraSystemPrompt`（工作区边界说明）和 `isAdmin: false`，与 Web 聊天对齐。

**Tech Stack:** TypeScript, Octopus Engine Config

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `.octopus-state/octopus.json` | 修改 | 添加全局 `tools.fs.workspaceOnly: true` |
| `apps/server/src/services/im/IMRouter.ts` | 修改 | `routeToAgent()` 补齐 `extraSystemPrompt` + `isAdmin: false` |
| `apps/server/src/services/im/IMRouter.ts` | 修改 | 提取 workspace 路径构建逻辑供 IM 链路复用 |

---

## Chunk 1: 全局 fs 隔离配置

### Task 1: 在 octopus.json 添加全局 tools.fs.workspaceOnly

**Files:**
- Modify: `.octopus-state/octopus.json`

- [ ] **Step 1: 添加全局 tools 配置**

在 `octopus.json` 顶层添加 `tools` 字段：

```json
{
  "tools": {
    "fs": {
      "workspaceOnly": true
    }
  }
}
```

位置：与 `models`、`agents`、`commands` 同级。

- [ ] **Step 2: 验证配置生效**

重启服务后确认 `workspaceOnly` 被引擎读取：

```bash
cd /home/baizh/octopus && ./start.sh restart
```

通过 Web 聊天尝试让 agent 读取 `/etc/hostname`，应被拒绝。

- [ ] **Step 3: Commit**

```bash
git add .octopus-state/octopus.json
git commit -m "fix(security): enable global tools.fs.workspaceOnly to restrict file access"
```

---

## Chunk 2: IM 链路对齐 Web 聊天的安全控制

### Task 2: IMRouter.routeToAgent() 注入 extraSystemPrompt 和 isAdmin

**Files:**
- Modify: `apps/server/src/services/im/IMRouter.ts:250-305`

- [ ] **Step 1: 给 IMRouter 构造函数增加 workspaceManager 依赖**

当前 `IMRouter` 构造函数签名：

```typescript
constructor(
  private prisma: AppPrismaClient,
  private bridge: EngineAdapter,
  private authService: AuthService,
  private ensureAgent: (userId: string, agentName: string) => Promise<void>,
  private dataRoot?: string,
)
```

添加 `workspaceManager` 参数（可选，保持向后兼容）：

```typescript
import type { WorkspaceManager } from '@octopus/workspace';

constructor(
  private prisma: AppPrismaClient,
  private bridge: EngineAdapter,
  private authService: AuthService,
  private ensureAgent: (userId: string, agentName: string) => Promise<void>,
  private dataRoot?: string,
  private workspaceManager?: WorkspaceManager,
)
```

- [ ] **Step 2: 在 routeToAgent() 构建 extraSystemPrompt**

在 `routeToAgent()` 方法中，调用 `bridge.callAgent()` 之前，构建工作区限制提示：

```typescript
// 构建 IM 链路的安全 system prompt
let extraSystemPrompt: string | undefined;
if (this.workspaceManager) {
  try {
    const workspacePath = this.workspaceManager.getSubPath(userId, 'WORKSPACE');
    const filesPath = this.workspaceManager.getSubPath(userId, 'FILES');
    const outputsPath = this.workspaceManager.getSubPath(userId, 'OUTPUTS');
    const tempPath = this.workspaceManager.getSubPath(userId, 'TEMP');
    extraSystemPrompt =
      `## 工作区\n` +
      `工作空间根目录: ${workspacePath}\n` +
      `用户上传文件: ${filesPath}\n` +
      `用户可下载文件: ${outputsPath}\n` +
      `临时工作目录: ${tempPath}\n\n` +
      `**文件管理规范（必须遵守）：**\n` +
      `- files/：用户上传的文件，只读取不修改\n` +
      `- outputs/：需要交付给用户的最终成果文件\n` +
      `- temp/：中间产物必须写入此目录\n` +
      `- 所有文件读写操作只能在 ${workspacePath} 目录内进行\n` +
      `- 严禁访问该目录之外的任何文件或目录`;
  } catch { /* ignore */ }
}
```

- [ ] **Step 3: 在 bridge.callAgent() 调用中传入新参数**

将当前的：

```typescript
this.bridge.callAgent(
  {
    message: msg.text,
    agentId,
    sessionKey,
    deliver: false,
  },
```

改为：

```typescript
this.bridge.callAgent(
  {
    message: msg.text,
    agentId,
    sessionKey,
    deliver: false,
    extraSystemPrompt,
    isAdmin: false,
  },
```

- [ ] **Step 4: 更新 IMRouter 实例化处，传入 workspaceManager**

找到 `IMRouter` 被实例化的地方（`apps/server/src/index.ts` 或 `apps/server/src/services/im/IMService.ts`），将 `workspaceManager` 传入构造函数。

查找位置：

```bash
grep -n "new IMRouter" apps/server/src/**/*.ts
```

在 `new IMRouter(prisma, bridge, authService, ensureAgent, dataRoot)` 后追加 `, workspaceManager`。

- [ ] **Step 5: 验证 IM 聊天工作区隔离**

通过 IM（飞书/Telegram）发消息让 agent 读取 `/etc/hostname` 或其他 workspace 外文件，确认：
1. `workspaceOnly` 从引擎层拒绝访问（硬限制）
2. `extraSystemPrompt` 告知 agent 正确的工作区路径（软限制）
3. `isAdmin: false` 确保 owner-only 工具被过滤

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/im/IMRouter.ts apps/server/src/services/im/IMService.ts
git commit -m "fix(security): inject workspace prompt and isAdmin=false in IM chat route"
```

---

## 验证清单

完成所有 Task 后，按以下顺序验证：

1. **引擎层硬限制**：Web 聊天 + IM 聊天都无法读取 workspace 外文件
2. **IM 链路 system prompt**：agent 知道正确的工作区路径
3. **isAdmin 控制**：IM 用户无法使用 owner-only 工具（如 gateway）
4. **正常功能不受影响**：agent 仍可正常读写 workspace 内文件、执行 skill、发送输出文件
5. **TypeScript 编译通过**：`cd apps/server && npx tsc --noEmit`
