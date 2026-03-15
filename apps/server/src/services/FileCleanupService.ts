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
    const filesCleaned = await this.cleanUploadedFiles();

    // 孤儿检测：每 24 小时一次
    if (this.config.cleanup.orphanDetectionEnabled) {
      const now = Date.now();
      if (now - this.lastOrphanScan > 24 * 60 * 60 * 1000) {
        this.lastOrphanScan = now;
        await this.cleanOrphanFiles();
      }
    }

    if (dbCleaned > 0 || tempCleaned > 0 || filesCleaned > 0) {
      console.log(`[cleanup] 清理完成: DB过期文件=${dbCleaned}, 临时文件=${tempCleaned}, 过期附件=${filesCleaned}`);
    }

    return { dbCleaned, fsCleaned: filesCleaned, tempCleaned };
  }

  private async cleanExpiredFromDB(): Promise<number> {
    const prisma = this.config.prisma;
    if (!prisma) return 0;

    try {
      const expired = await prisma.generatedFile.findMany({
        where: { status: 'active', expiresAt: { lt: new Date() } },
        take: 100,
      });

      let cleaned = 0;
      for (const file of expired) {
        const absPath = path.join(this.config.dataRoot, 'users', file.userId, 'workspace', file.filePath);
        try {
          if (fs.existsSync(absPath)) await fsp.unlink(absPath);
        } catch (err: any) {
          console.warn(`[cleanup] 删除文件失败 ${absPath}: ${err.message}`);
        }
        await prisma.generatedFile.update({ where: { id: file.id }, data: { status: 'deleted' } });
        cleaned++;
      }
      return cleaned;
    } catch (err: any) {
      console.error('[cleanup] DB 清理失败:', err.message);
      return 0;
    }
  }

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

  /** 清理超过保留期的上传附件（files/ 目录） */
  private async cleanUploadedFiles(): Promise<number> {
    const usersDir = path.join(this.config.dataRoot, 'users');
    if (!fs.existsSync(usersDir)) return 0;

    const cutoffMs = (this.config.cleanup.filesRetentionDays ?? 30) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - cutoffMs;
    let cleaned = 0;

    try {
      const users = await fsp.readdir(usersDir, { withFileTypes: true });
      for (const user of users) {
        if (!user.isDirectory()) continue;
        // 清理用户主 workspace 的 files/
        const filesDir = path.join(usersDir, user.name, 'workspace', 'files');
        cleaned += await this.cleanOldFilesInDir(filesDir, cutoffTime);
        // 清理各 agent workspace 的 files/
        const agentsDir = path.join(usersDir, user.name, 'agents');
        if (fs.existsSync(agentsDir)) {
          const agents = await fsp.readdir(agentsDir, { withFileTypes: true });
          for (const agent of agents) {
            if (!agent.isDirectory()) continue;
            const agentFilesDir = path.join(agentsDir, agent.name, 'files');
            cleaned += await this.cleanOldFilesInDir(agentFilesDir, cutoffTime);
          }
        }
      }
    } catch (err: any) {
      console.error('[cleanup] files/ 清理失败:', err.message);
    }
    return cleaned;
  }

  /** 清理指定目录中超过截止时间的文件 */
  private async cleanOldFilesInDir(dir: string, cutoffTime: number): Promise<number> {
    if (!fs.existsSync(dir)) return 0;
    let cleaned = 0;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
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
    } catch { /* 忽略目录读取失败 */ }
    return cleaned;
  }

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
            if (stat.mtimeMs > cutoffTime) continue;

            const record = await prisma.generatedFile.findFirst({
              where: { userId: user.name, filePath: `outputs/${fileName}`, status: 'active' },
            });

            if (!record) {
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

    if (cleaned > 0) console.log(`[cleanup] 孤儿文件清理: ${cleaned} 个`);
    return cleaned;
  }
}
