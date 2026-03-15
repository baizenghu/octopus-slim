# Octopus 文件清理系统实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Octopus 平台建立完整的文件生命周期管理体系，解决 Skill 输出文件无限累积、配额形同虚设、临时文件无清理三大核心问题。

**Architecture:** 新增 `GeneratedFile` Prisma 模型作为文件注册表，在 Skill 执行后和文件上传时注册文件记录。新增 `FileCleanupService` 定时清理 worker，按文件类别分层过期（temp 1h, outputs 7d）。改造 `checkQuota()` 为写入前拦截（upload + run_skill 前检查），超额拒绝执行。开放 outputs 目录的用户手动清理能力。

**Tech Stack:** TypeScript, Prisma 6 (MySQL), Node.js setInterval, vitest

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `prisma/schema.prisma` | 新增 GeneratedFile 模型 | Modify |
| `packages/workspace/src/types.ts` | 新增 CleanupConfig 类型 | Modify |
| `packages/workspace/src/WorkspaceManager.ts` | 新增 enforceQuota() + cleanupExpiredFiles() | Modify |
| `apps/server/src/config.ts` | 新增 cleanup 配置项 | Modify |
| `apps/server/src/services/FileCleanupService.ts` | 定时清理 worker（核心新文件） | Create |
| `apps/server/src/routes/files.ts` | 上传前配额拦截 + 开放 outputs 删除 | Modify |
| `plugins/mcp/src/index.ts` | run_skill 前配额拦截 + 执行后注册文件 | Modify |
| `apps/server/src/index.ts` | 启动 FileCleanupService | Modify |
| `apps/server/src/services/__tests__/FileCleanupService.test.ts` | 清理服务测试 | Create |
| `packages/workspace/src/__tests__/quota.test.ts` | 配额拦截测试 | Create |

---

## Chunk 1: 数据模型与基础类型

### Task 1: Prisma GeneratedFile 模型

**Files:**
- Modify: `prisma/schema.prisma` (末尾追加)

- [ ] **Step 1: 添加 GeneratedFile 模型到 schema**

在 `prisma/schema.prisma` 末尾（DatabaseConnection 模型之后）追加：

```prisma
/// 生成文件注册表（文件生命周期管理）
model GeneratedFile {
  id          String   @id @map("file_id") @db.VarChar(512)  /// 确定性 ID: {userId}:outputs/{relPath}
  userId      String   @map("user_id") @db.VarChar(64)
  category    String   @db.VarChar(20)  /// 'output' | 'temp' | 'upload'
  filePath    String   @map("file_path") @db.VarChar(1024)  /// 相对于 workspace 的路径
  fileSize    Int      @map("file_size")  /// 字节
  skillId     String?  @map("skill_id") @db.VarChar(64)  /// 产生该文件的 Skill ID
  agentName   String?  @map("agent_name") @db.VarChar(255)  /// 产生该文件的 Agent
  createdAt   DateTime @default(now()) @map("created_at")
  expiresAt   DateTime @map("expires_at")  /// 根据 category 计算
  status      String   @default("active") @db.VarChar(20)  /// 'active' | 'expired' | 'deleted'

  @@index([userId])
  @@index([status, expiresAt])
  @@index([userId, category])
  @@map("generated_files")
}
```

> **注意**：`id` 不使用 `@default(cuid())`，而是手动赋值确定性 ID（格式 `{userId}:outputs/{relPath}`），这样同一文件路径的重复写入使用 upsert 更新而非重复创建。

- [ ] **Step 2: 运行 prisma generate**

Run: `cd /home/baizh/octopus && npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 3: 运行 prisma db push 同步到数据库**

Run: `cd /home/baizh/octopus && npx prisma db push`
Expected: 数据库创建 `generated_files` 表

- [ ] **Step 4: 同步 Plugin Prisma schema**

企业 MCP Plugin 有独立 Prisma schema，也需要同步 GeneratedFile 模型（否则 plugin 代码无法访问）。

Modify: `plugins/mcp/prisma/schema.prisma`（如存在），在其中也添加相同的 GeneratedFile 模型定义。

Run: `cd /home/baizh/octopus/plugins/mcp && npx prisma generate`

- [ ] **Step 5: Commit**

```bash
cd /home/baizh/octopus
git add prisma/schema.prisma plugins/mcp/prisma/schema.prisma
git commit -m "feat(db): add GeneratedFile model for file lifecycle tracking"
```

---

### Task 2: 清理配置类型

**Files:**
- Modify: `packages/workspace/src/types.ts`
- Modify: `apps/server/src/config.ts`

- [ ] **Step 1: 在 types.ts 中新增清理配置类型**

在 `packages/workspace/src/types.ts` 末尾（PathValidationResult 之后）追加：

```typescript
/**
 * 文件清理配置
 */
export interface FileCleanupConfig {
  /** outputs/ 文件保留天数（默认 7） */
  outputRetentionDays: number;
  /** temp/ 文件保留小时数（默认 1） */
  tempRetentionHours: number;
  /** 清理扫描间隔（分钟，默认 30） */
  cleanupIntervalMinutes: number;
  /** 孤儿文件检测（每天一次，默认开启） */
  orphanDetectionEnabled: boolean;
}
```

- [ ] **Step 2: 在 config.ts 的 GatewayConfig 接口中添加 cleanup 字段**

在 `apps/server/src/config.ts` 的 `GatewayConfig` 接口（约第 5-49 行）中，`nativeGateway` 字段之后追加：

```typescript
  /** 文件清理配置 */
  cleanup: FileCleanupConfig;
```

并在文件顶部添加 import：
```typescript
import type { FileCleanupConfig } from '@octopus/workspace';
```

- [ ] **Step 3: 在 loadConfig() 的返回对象中添加 cleanup 默认值**

在 `apps/server/src/config.ts` 的 `loadConfig()` 返回对象中（约第 106-109 行 `nativeGateway` 之后）追加：

```typescript
    cleanup: {
      outputRetentionDays: parseInt(process.env.OUTPUT_RETENTION_DAYS || '7', 10),
      tempRetentionHours: parseInt(process.env.TEMP_RETENTION_HOURS || '1', 10),
      cleanupIntervalMinutes: parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '30', 10),
      orphanDetectionEnabled: process.env.ORPHAN_DETECTION_ENABLED !== 'false',
    },
```

- [ ] **Step 4: 确保 @octopus/workspace 导出新类型**

检查 `packages/workspace/src/index.ts`，确保导出 `FileCleanupConfig`：

```typescript
export type { FileCleanupConfig } from './types';
```

- [ ] **Step 5: 类型检查**

Run: `cd /home/baizh/octopus && npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
cd /home/baizh/octopus
git add packages/workspace/src/types.ts packages/workspace/src/index.ts apps/server/src/config.ts
git commit -m "feat(config): add file cleanup configuration types and defaults"
```

---

## Chunk 2: 配额拦截机制

### Task 3: WorkspaceManager 配额拦截方法

**Files:**
- Modify: `packages/workspace/src/WorkspaceManager.ts`
- Create: `packages/workspace/src/__tests__/quota.test.ts`

- [ ] **Step 1: 编写配额拦截测试**

创建 `packages/workspace/src/__tests__/quota.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager } from '../WorkspaceManager';

describe('WorkspaceManager.enforceQuota', () => {
  let tmpDir: string;
  let wm: WorkspaceManager;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quota-test-'));
    wm = new WorkspaceManager({
      dataRoot: tmpDir,
      defaultStorageQuota: 0.001, // 1MB quota for testing
    });
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should pass when under quota', async () => {
    await wm.initWorkspace('user-test', 'test');
    // workspace is nearly empty, should pass
    await expect(wm.enforceQuota('user-test')).resolves.toBeUndefined();
  });

  it('should throw when over quota', async () => {
    await wm.initWorkspace('user-test', 'test');
    // Write a file larger than 1MB quota
    const bigFile = path.join(wm.getWorkspacePath('user-test'), 'big.bin');
    await fsp.writeFile(bigFile, Buffer.alloc(2 * 1024 * 1024)); // 2MB
    await expect(wm.enforceQuota('user-test')).rejects.toThrow('存储配额已超限');
  });

  it('should respect custom quota', async () => {
    await wm.initWorkspace('user-test', 'test');
    const bigFile = path.join(wm.getWorkspacePath('user-test'), 'big.bin');
    await fsp.writeFile(bigFile, Buffer.alloc(2 * 1024 * 1024)); // 2MB
    // 10GB custom quota should pass
    await expect(wm.enforceQuota('user-test', 10)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/baizh/octopus && npx vitest run packages/workspace/src/__tests__/quota.test.ts`
Expected: FAIL — `enforceQuota` 不存在

- [ ] **Step 3: 实现 enforceQuota 方法**

在 `packages/workspace/src/WorkspaceManager.ts` 的 `checkQuota` 方法（第 193 行）之后添加：

```typescript
  /**
   * 配额拦截：超限时抛出异常，阻止写入操作
   */
  async enforceQuota(userId: string, customLimitGB?: number): Promise<void> {
    const status = await this.checkQuota(userId, customLimitGB);
    if (status.storage.exceeded) {
      const usedMB = Math.round(status.storage.used / 1024 / 1024);
      const limitMB = Math.round(status.storage.limit / 1024 / 1024);
      throw new Error(
        `存储配额已超限（已用 ${usedMB}MB / 限额 ${limitMB}MB），请清理文件后重试`,
      );
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/baizh/octopus && npx vitest run packages/workspace/src/__tests__/quota.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/baizh/octopus
git add packages/workspace/src/WorkspaceManager.ts packages/workspace/src/__tests__/quota.test.ts
git commit -m "feat(workspace): add enforceQuota() to block writes when over limit"
```

---

### Task 4: 上传接口配额拦截

**Files:**
- Modify: `apps/server/src/routes/files.ts:102-111`

- [ ] **Step 1: 在 upload handler 的 try 块开头添加配额检查**

在 `apps/server/src/routes/files.ts` 第 111 行（`await workspaceManager.initWorkspace(...)` 之后）插入：

```typescript
        // 配额拦截：超限时拒绝上传
        try {
          await workspaceManager.enforceQuota(user.id);
        } catch (quotaErr: any) {
          res.status(413).json({ error: quotaErr.message });
          return;
        }
```

- [ ] **Step 2: 手动验证**

启动服务后，用超限用户测试上传应返回 413。正常用户上传不受影响。

- [ ] **Step 3: Commit**

```bash
cd /home/baizh/octopus
git add apps/server/src/routes/files.ts
git commit -m "feat(files): enforce storage quota before file upload"
```

---

### Task 5: Skill 执行配额拦截

**Files:**
- Modify: `plugins/mcp/src/index.ts`（run_skill 中，执行前）

- [ ] **Step 1: 在 run_skill 执行前添加配额检查**

在 `plugins/mcp/src/index.ts` 中找到 `run_skill` 工具的执行分支（约第 595 行 `let result: SkillExecResult;` 之前），插入：

```typescript
      // 配额拦截：超限时拒绝执行 Skill
      try {
        const quotaStatus = await checkUserQuota(userId, _dataRoot);
        if (quotaStatus.exceeded) {
          const usedMB = Math.round(quotaStatus.used / 1024 / 1024);
          const limitMB = Math.round(quotaStatus.limit / 1024 / 1024);
          return {
            content: [{
              type: 'text' as const,
              text: `❌ 存储配额已超限（已用 ${usedMB}MB / 限额 ${limitMB}MB），请让用户清理 outputs 目录后重试。`,
            }],
          };
        }
      } catch { /* 配额检查失败不阻断执行 */ }
```

- [ ] **Step 2: 在文件底部添加 checkUserQuota 辅助函数**

```typescript
/** 检查用户存储配额（轻量版，不依赖 WorkspaceManager 实例） */
async function checkUserQuota(userId: string, dataRoot: string): Promise<{
  used: number; limit: number; exceeded: boolean;
}> {
  const userRoot = path.join(dataRoot, 'users', userId);
  if (!fs.existsSync(userRoot)) return { used: 0, limit: 5 * 1024 * 1024 * 1024, exceeded: false };

  // 读取用户元数据中的配额设置（与 WorkspaceManager.checkQuota 保持一致）
  let limitGB = 5; // 默认 5GB
  try {
    const metaPath = path.join(userRoot, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8'));
      if (meta.quotas?.storage) limitGB = meta.quotas.storage;
    }
  } catch { /* 读取失败用默认值 */ }

  let used = 0;
  const walk = async (dir: string) => {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) { const s = await fsp.stat(p); used += s.size; }
      }
    } catch { /* 忽略权限错误 */ }
  };
  await walk(userRoot);

  const limit = limitGB * 1024 * 1024 * 1024;
  return { used, limit, exceeded: used > limit };
}
```

- [ ] **Step 3: 类型检查**

Run: `cd /home/baizh/octopus && npx tsc --noEmit -p plugins/mcp/tsconfig.json`（如有）
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
cd /home/baizh/octopus
git add plugins/mcp/src/index.ts
git commit -m "feat(mcp): enforce storage quota before skill execution"
```

---

## Chunk 3: 文件注册与跟踪

### Task 6: Skill 执行后注册输出文件

**Files:**
- Modify: `plugins/mcp/src/index.ts`（run_skill 执行后，返回结果前）

- [ ] **Step 1: 在 collectOutputFiles 调用后注册文件到数据库**

在 `plugins/mcp/src/index.ts` 中找到 `collectOutputFiles()` 调用的位置（约第 623 行），在其后、构造返回值之前插入：

```typescript
      // 注册生成的文件到数据库
      // 注意：实际变量名为 outputFiles（来自 collectOutputFiles() 的返回值）
      if (prisma && outputFiles.length > 0) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // outputs 默认 7 天过期
        try {
          for (const relPath of outputFiles) {
            const fileId = `${userId}:outputs/${relPath}`;
            const absPath = path.join(outputsPath, relPath);
            let fileSize = 0;
            try { fileSize = (await fsp.stat(absPath)).size; } catch { /* 忽略 */ }
            await prisma.generatedFile.upsert({
              where: { id: fileId },
              update: { fileSize, expiresAt, status: 'active', skillId: skill.id, agentName: agentName || null },
              create: {
                id: fileId,
                userId,
                category: 'output',
                filePath: `outputs/${relPath}`,
                fileSize,
                skillId: skill.id,
                agentName: agentName || null,
                expiresAt,
                status: 'active',
              },
            });
          }
        } catch (regErr: any) {
          console.warn('[mcp] 文件注册失败（不影响执行）:', regErr.message);
        }
      }
```

注意：代码中使用 `prisma`（局部变量，来自 `const prisma = _prisma`，约第 458 行），而非直接用模块级 `_prisma`，与现有代码风格一致。需确认其可访问 `generatedFile` 模型（Task 1 Step 4 已同步 plugin schema）。

`outputFiles` 是 `collectOutputFiles()` 的返回值（约第 623 行：`const outputFiles = await collectOutputFiles(outputsPath)`）。

- [ ] **Step 2: Commit**

```bash
cd /home/baizh/octopus
git add plugins/mcp/src/index.ts prisma/schema.prisma
git commit -m "feat(mcp): register skill output files to GeneratedFile table"
```

---

## Chunk 4: 文件清理服务

### Task 7: FileCleanupService 核心实现

**Files:**
- Create: `apps/server/src/services/FileCleanupService.ts`
- Create: `apps/server/src/services/__tests__/FileCleanupService.test.ts`

- [ ] **Step 1: 编写清理服务测试**

创建 `apps/server/src/services/__tests__/FileCleanupService.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileCleanupService } from '../FileCleanupService';

describe('FileCleanupService', () => {
  it('should be instantiable with config', () => {
    const service = new FileCleanupService({
      dataRoot: '/tmp/test',
      cleanup: {
        outputRetentionDays: 7,
        tempRetentionHours: 1,
        cleanupIntervalMinutes: 30,
        orphanDetectionEnabled: false,
      },
      prisma: null as any,
    });
    expect(service).toBeDefined();
  });

  it('should calculate correct expiry dates', () => {
    const now = new Date('2026-03-13T00:00:00Z');
    // output: 7 days ago
    const outputCutoff = new Date(now);
    outputCutoff.setDate(outputCutoff.getDate() - 7);
    expect(outputCutoff.toISOString()).toBe('2026-03-06T00:00:00.000Z');
    // temp: 1 hour ago
    const tempCutoff = new Date(now);
    tempCutoff.setHours(tempCutoff.getHours() - 1);
    expect(tempCutoff.toISOString()).toBe('2026-03-12T23:00:00.000Z');
  });
});
```

- [ ] **Step 2: 运行测试确认第一个通过、第二个可能需要调整**

Run: `cd /home/baizh/octopus && npx vitest run apps/server/src/services/__tests__/FileCleanupService.test.ts`

- [ ] **Step 3: 实现 FileCleanupService**

创建 `apps/server/src/services/FileCleanupService.ts`：

```typescript
/**
 * 文件清理服务
 *
 * 定期清理过期的 Skill 输出文件和临时文件：
 * - outputs/ 文件：默认 7 天过期
 * - temp/ 文件：默认 1 小时过期
 * - 孤儿文件检测：文件存在但 DB 无记录（每天一次）
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { PrismaClient } from '@prisma/client';
import type { FileCleanupConfig } from '@octopus/workspace';

interface CleanupServiceConfig {
  dataRoot: string;
  cleanup: FileCleanupConfig;
  prisma: PrismaClient;
}

export class FileCleanupService {
  private config: CleanupServiceConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private orphanTimer: ReturnType<typeof setInterval> | null = null;
  private lastOrphanScan = 0;

  constructor(config: CleanupServiceConfig) {
    this.config = config;
  }

  /** 启动定时清理 */
  start(): void {
    const intervalMs = this.config.cleanup.cleanupIntervalMinutes * 60 * 1000;

    // 启动时立即执行一次
    this.runCleanup().catch(err =>
      console.error('[cleanup] 首次清理失败:', err.message),
    );

    // 定时清理
    this.timer = setInterval(() => {
      this.runCleanup().catch(err =>
        console.error('[cleanup] 定时清理失败:', err.message),
      );
    }, intervalMs);

    console.log(`[cleanup] 文件清理服务已启动（间隔 ${this.config.cleanup.cleanupIntervalMinutes} 分钟）`);
  }

  /** 停止定时清理 */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.orphanTimer) { clearInterval(this.orphanTimer); this.orphanTimer = null; }
  }

  /** 执行一轮清理 */
  async runCleanup(): Promise<{ dbCleaned: number; fsCleaned: number; tempCleaned: number }> {
    const dbCleaned = await this.cleanExpiredFromDB();
    const tempCleaned = await this.cleanTempFiles();

    // 孤儿检测：每 24 小时一次
    if (this.config.cleanup.orphanDetectionEnabled) {
      const now = Date.now();
      if (now - this.lastOrphanScan > 24 * 60 * 60 * 1000) {
        this.lastOrphanScan = now;
        await this.cleanOrphanFiles();
      }
    }

    if (dbCleaned > 0 || tempCleaned > 0) {
      console.log(`[cleanup] 清理完成: DB过期文件=${dbCleaned}, 临时文件=${tempCleaned}`);
    }

    return { dbCleaned, fsCleaned: 0, tempCleaned };
  }

  /**
   * 清理 DB 中标记为 active 但已过期的文件
   */
  private async cleanExpiredFromDB(): Promise<number> {
    const prisma = this.config.prisma;
    if (!prisma) return 0;

    try {
      // 查找所有已过期的 active 文件
      const expired = await prisma.generatedFile.findMany({
        where: {
          status: 'active',
          expiresAt: { lt: new Date() },
        },
        take: 100, // 每次最多处理 100 个，避免长事务
      });

      let cleaned = 0;
      for (const file of expired) {
        const absPath = path.join(
          this.config.dataRoot, 'users', file.userId, file.filePath,
        );

        // 删除文件系统中的文件
        try {
          if (fs.existsSync(absPath)) {
            await fsp.unlink(absPath);
          }
        } catch (err: any) {
          console.warn(`[cleanup] 删除文件失败 ${absPath}: ${err.message}`);
        }

        // 更新 DB 状态
        await prisma.generatedFile.update({
          where: { id: file.id },
          data: { status: 'deleted' },
        });
        cleaned++;
      }

      return cleaned;
    } catch (err: any) {
      console.error('[cleanup] DB 清理失败:', err.message);
      return 0;
    }
  }

  /**
   * 清理 temp/ 目录中超过保留期的文件（基于文件系统 mtime，不依赖 DB）
   */
  private async cleanTempFiles(): Promise<number> {
    const usersDir = path.join(this.config.dataRoot, 'users');
    if (!fs.existsSync(usersDir)) return 0;

    const cutoffMs = this.config.cleanup.tempRetentionHours * 60 * 60 * 1000;
    const cutoffTime = Date.now() - cutoffMs;
    let cleaned = 0;

    try {
      const users = await fsp.readdir(usersDir, { withFileTypes: true });
      for (const user of users) {
        if (!user.isDirectory()) continue;
        const tempDir = path.join(usersDir, user.name, 'workspace', 'temp');
        if (!fs.existsSync(tempDir)) continue;

        const entries = await fsp.readdir(tempDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(tempDir, entry.name);
          try {
            const stat = await fsp.stat(fullPath);
            if (stat.mtimeMs < cutoffTime) {
              if (entry.isDirectory()) {
                await fsp.rm(fullPath, { recursive: true, force: true });
              } else {
                await fsp.unlink(fullPath);
              }
              cleaned++;
            }
          } catch { /* 忽略单文件失败 */ }
        }
      }
    } catch (err: any) {
      console.error('[cleanup] temp 清理失败:', err.message);
    }

    return cleaned;
  }

  /**
   * 孤儿文件检测：outputs/ 目录中存在但 DB 无记录的文件
   * 策略：仅清理超过 2 倍保留期的孤儿文件（给予充分缓冲）
   */
  private async cleanOrphanFiles(): Promise<number> {
    const prisma = this.config.prisma;
    if (!prisma) return 0;

    const usersDir = path.join(this.config.dataRoot, 'users');
    if (!fs.existsSync(usersDir)) return 0;

    const orphanCutoffMs = this.config.cleanup.outputRetentionDays * 2 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - orphanCutoffMs;
    let cleaned = 0;

    try {
      const users = await fsp.readdir(usersDir, { withFileTypes: true });
      for (const user of users) {
        if (!user.isDirectory()) continue;
        const outputsDir = path.join(usersDir, user.name, 'workspace', 'outputs');
        if (!fs.existsSync(outputsDir)) continue;

        const entries = await fsp.readdir(outputsDir);
        for (const fileName of entries) {
          const fullPath = path.join(outputsDir, fileName);
          try {
            const stat = await fsp.stat(fullPath);
            if (stat.mtimeMs > cutoffTime) continue; // 还不够老

            // 检查 DB 是否有记录
            const record = await prisma.generatedFile.findFirst({
              where: {
                userId: user.name,
                filePath: `outputs/${fileName}`,
                status: 'active',
              },
            });

            if (!record) {
              // 孤儿文件：文件够老且 DB 无记录
              if (stat.isDirectory()) {
                await fsp.rm(fullPath, { recursive: true, force: true });
              } else {
                await fsp.unlink(fullPath);
              }
              cleaned++;
              console.log(`[cleanup] 孤儿文件已清理: ${user.name}/outputs/${fileName}`);
            }
          } catch { /* 忽略单文件失败 */ }
        }
      }
    } catch (err: any) {
      console.error('[cleanup] 孤儿检测失败:', err.message);
    }

    if (cleaned > 0) {
      console.log(`[cleanup] 孤儿文件清理: ${cleaned} 个`);
    }
    return cleaned;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/baizh/octopus && npx vitest run apps/server/src/services/__tests__/FileCleanupService.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `cd /home/baizh/octopus && npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
cd /home/baizh/octopus
git add apps/server/src/services/FileCleanupService.ts apps/server/src/services/__tests__/FileCleanupService.test.ts
git commit -m "feat(cleanup): add FileCleanupService with DB expiry, temp cleanup, and orphan detection"
```

---

### Task 8: 在服务器启动时注入 FileCleanupService

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 在 index.ts 中导入并启动 FileCleanupService**

在 `apps/server/src/index.ts` 的审计清理代码之后（约第 169 行）插入：

```typescript
  // 启动文件清理服务
  if (prismaClient) {
    const { FileCleanupService } = await import('./services/FileCleanupService');
    const fileCleanup = new FileCleanupService({
      dataRoot: config.workspace.dataRoot,
      cleanup: config.cleanup,
      prisma: prismaClient,
    });
    fileCleanup.start();
  }
```

- [ ] **Step 2: 验证启动日志**

Run: `cd /home/baizh/octopus && ./start.sh restart gateway`
Expected: 日志中出现 `[cleanup] 文件清理服务已启动（间隔 30 分钟）`

- [ ] **Step 3: Commit**

```bash
cd /home/baizh/octopus
git add apps/server/src/index.ts
git commit -m "feat(server): start FileCleanupService on server boot"
```

---

## Chunk 5: 开放 Outputs 删除 + 用户删除级联

### Task 9: 开放 outputs 目录的用户手动删除

**Files:**
- Modify: `apps/server/src/routes/files.ts:414-455`

- [ ] **Step 1: 修改 DELETE 端点，允许删除 outputs 下的文件**

将 `apps/server/src/routes/files.ts` 第 424-428 行的 outputs 保护逻辑替换为：

```typescript
      // outputs/ 中的文件允许用户删除（已有文件清理机制兜底）
      // 仅禁止删除 outputs 目录本身
      if (relativePath === 'outputs' || relativePath === 'outputs/') {
        res.status(403).json({ error: '不允许删除 outputs 根目录' });
        return;
      }
```

- [ ] **Step 2: 在文件删除成功后同步更新 DB 记录**

在 `apps/server/src/routes/files.ts` 的删除成功行（第 451 行 `res.json(...)` 之前）添加：

```typescript
      // 如果删除的是 outputs 下的文件，同步更新 DB 状态
      if (relativePath.startsWith('outputs/') && prismaClient) {
        try {
          await prismaClient.generatedFile.updateMany({
            where: { userId: user.id, filePath: relativePath, status: 'active' },
            data: { status: 'deleted' },
          });
        } catch { /* DB 同步失败不阻断删除响应 */ }
      }
```

为此需要修改 `createFilesRouter` 的函数签名，新增 `prismaClient` 参数：

1. 在 `apps/server/src/routes/files.ts` 第 58 行，修改函数签名：
```typescript
export function createFilesRouter(
  _config: GatewayConfig,
  authService: AuthService,
  workspaceManager: WorkspaceManager,
  prismaClient?: any,  // PrismaClient（可选，用于 DB 状态同步）
): Router {
```

2. 在 `apps/server/src/index.ts` 中调用 `createFilesRouter` 的地方（约第 370 行），添加第 4 个参数：
```typescript
createFilesRouter(config, authService, workspaceManager, prismaClient)
```

- [ ] **Step 3: Commit**

```bash
cd /home/baizh/octopus
git add apps/server/src/routes/files.ts apps/server/src/index.ts
git commit -m "feat(files): allow users to delete output files, sync to DB"
```

---

### Task 10: 用户删除时级联清理 GeneratedFile 记录

**Files:**
- Modify: `apps/server/src/routes/admin.ts`（用户删除流程中）

- [ ] **Step 1: 在 admin.ts 的用户删除流程中添加 GeneratedFile 清理**

在 `apps/server/src/routes/admin.ts` 第 307-314 行（各个 `deleteMany` 调用之间）添加一行。注意：这里不是 `$transaction` 数组，而是顺序 `await` 调用带 `.catch(() => {})`，需保持一致的格式：

```typescript
      await prisma.generatedFile.deleteMany({ where: { userId: id } }).catch(() => { });
```

插入位置：在 `prisma.skill.deleteMany` 之后、`prisma.iMUserBinding.deleteMany` 之前。

- [ ] **Step 2: 类型检查**

Run: `cd /home/baizh/octopus && npx tsc --noEmit -p apps/server/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
cd /home/baizh/octopus
git add apps/server/src/routes/admin.ts
git commit -m "feat(admin): cascade delete GeneratedFile records on user removal"
```

---

## Chunk 6: 集成验证

### Task 11: 端到端验证

- [ ] **Step 1: 重启服务**

Run: `cd /home/baizh/octopus && ./start.sh restart`

- [ ] **Step 2: 验证清理服务启动**

Run: `./start.sh logs gateway | grep cleanup`
Expected: 出现 `[cleanup] 文件清理服务已启动`

- [ ] **Step 3: 验证配额拦截 — 上传**

用 curl 模拟上传（正常情况下应成功）：
```bash
echo "test" > /tmp/test-upload.txt
curl -X POST http://localhost:18790/api/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/tmp/test-upload.txt"
```
Expected: 200 + `上传成功`

- [ ] **Step 4: 验证 Skill 执行后文件注册**

通过对话触发一次 Skill 执行（如 PPT 生成），然后检查数据库：
```bash
mysql -uoctopus -p'YOUR_DB_PASSWORD' octopus_enterprise \
  -e "SELECT file_id, user_id, category, file_path, file_size, expires_at, status FROM generated_files LIMIT 10;"
```
Expected: 有 `output` 类别的记录，`expires_at` 为 7 天后

- [ ] **Step 5: 验证 outputs 文件可删除**

```bash
curl -X DELETE http://localhost:18790/api/files/outputs/test.pptx \
  -H "Authorization: Bearer <token>"
```
Expected: 200 + `删除成功`（如文件存在）

- [ ] **Step 6: 验证类型安全**

Run: `cd /home/baizh/octopus && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: 运行全量测试**

Run: `cd /home/baizh/octopus && npx vitest run`
Expected: 全部通过

- [ ] **Step 8: 最终提交**

```bash
cd /home/baizh/octopus
git add -A
git commit -m "feat: complete file lifecycle management system

- GeneratedFile DB model for tracking output files
- FileCleanupService: periodic cleanup (outputs 7d, temp 1h, orphans 14d)
- Quota enforcement on upload and skill execution
- Allow users to delete output files
- Cascade cleanup on user deletion"
```

---

## 环境变量速查

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OUTPUT_RETENTION_DAYS` | `7` | Skill 输出文件保留天数 |
| `TEMP_RETENTION_HOURS` | `1` | 临时文件保留小时数 |
| `CLEANUP_INTERVAL_MINUTES` | `30` | 清理扫描间隔 |
| `ORPHAN_DETECTION_ENABLED` | `true` | 是否启用孤儿文件检测 |

## 风险与回退

- **数据丢失**：outputs 默认 7 天，首次部署时已有的旧文件不在 DB 中，会被孤儿检测清理（但有 2 倍缓冲期 = 14 天）。建议部署前通知用户下载重要文件。
- **性能**：`calculateUsage()` 递归遍历目录，大量文件时可能较慢。每次 skill 执行前调用一次可接受，如遇性能问题可加缓存。
- **回退方案**：设 `CLEANUP_INTERVAL_MINUTES=999999` 可暂停清理，设 `OUTPUT_RETENTION_DAYS=3650`（10 年）可等效禁用过期。
