/**
 * 审计日志记录器
 *
 * 支持双写策略：
 * 1. Winston 文件日志（30天滚动，gzip 压缩）
 * 2. Prisma 数据库持久化（MySQL audit_logs 表）
 *
 * 任一通道失败不阻塞另一个。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { createLogger, format, transports, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { PrismaClient } from '@prisma/client';
import type {
  AuditLogEntry,
  AuditLogRecord,
  AuditLoggerConfig,
  AuditQueryFilters,
  AuditQueryResult,
  AuditExportFormat,
  AuditArchiveResult,
} from './types';

/**
 * 审计日志记录器
 */
export class AuditLogger {
  private config: AuditLoggerConfig;
  private prisma?: PrismaClient;
  private logger: Logger;
  private exportDir: string;
  private archiveDir: string;

  constructor(config: AuditLoggerConfig) {
    this.config = config;
    this.prisma = config.enableDatabase ? config.prisma : undefined;

    // 确保目录存在
    fs.mkdirSync(config.logDir, { recursive: true });
    this.exportDir = path.join(config.logDir, 'exports');
    this.archiveDir = path.join(config.logDir, 'archive');
    fs.mkdirSync(this.exportDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });

    // 初始化 Winston 日志器
    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        format.json(),
      ),
      transports: [
        new DailyRotateFile({
          dirname: config.logDir,
          filename: 'audit-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: `${config.retentionDays}d`,
          zippedArchive: true,
          format: format.combine(
            format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            format.json(),
          ),
        }),
      ],
    });
  }

  /**
   * 关闭日志写入器（释放文件句柄）
   * 在应用关闭或测试清理时调用
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.on('finish', resolve);
      this.logger.end();
    });
  }

  /**
   * 记录审计日志（双写：文件 + 数据库）
   */
  async log(entry: AuditLogEntry): Promise<void> {
    const timestamp = new Date();

    // 1. Winston 文件写入
    try {
      this.logger.info('audit', {
        ...entry,
        timestamp: timestamp.toISOString(),
      });
    } catch (err) {
      console.error('[AuditLogger] Winston write failed:', err);
    }

    // 2. Prisma 数据库写入
    if (this.prisma) {
      try {
        await this.prisma.auditLog.create({
          data: {
            userId: entry.userId,
            action: entry.action,
            resource: entry.resource || null,
            details: entry.details ? (entry.details as any) : undefined,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
            success: entry.success ?? true,
            errorMessage: entry.errorMessage || null,
            durationMs: entry.durationMs || null,
          },
        });
      } catch (err: any) {
        // FK violation on user_id — retry with null userId (user not in DB yet)
        if (err?.code === 'P2003') {
          try {
            await this.prisma.auditLog.create({
              data: {
                userId: null,
                action: entry.action,
                resource: entry.resource || null,
                details: entry.details ? (entry.details as any) : undefined,
                ipAddress: entry.ipAddress || null,
                userAgent: entry.userAgent || null,
                success: entry.success ?? true,
                errorMessage: entry.errorMessage || null,
                durationMs: entry.durationMs || null,
              },
            });
          } catch {
            console.error('[AuditLogger] Database write failed (FK fallback):', err.message);
          }
        } else {
          console.error('[AuditLogger] Database write failed:', err);
        }
      }
    }
  }

  /**
   * 查询审计日志（分页 + 多条件过滤）
   */
  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    if (!this.prisma) {
      return { data: [], total: 0, offset: 0, limit: 0 };
    }

    const where = this.buildWhereClause(filters);
    const limit = Math.min(filters.limit || 50, 500);
    const offset = filters.offset || 0;
    const orderBy = filters.orderBy || 'desc';

    const [records, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: orderBy },
        skip: offset,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // 通过 User JOIN 获取 username，避免额外查询
    const data: AuditLogRecord[] = records.map((r: any) => ({
      logId: r.logId,
      userId: r.userId || '',
      username: r.user?.username || '',
      action: r.action as any,
      resource: r.resource || undefined,
      details: (r.details as Record<string, unknown>) || undefined,
      ipAddress: r.ipAddress || undefined,
      userAgent: r.userAgent || undefined,
      success: r.success,
      errorMessage: r.errorMessage || undefined,
      durationMs: r.durationMs || undefined,
      createdAt: r.createdAt,
    }));

    return { data, total, offset, limit };
  }

  /**
   * 导出审计日志为文件
   *
   * @returns 导出文件的绝对路径
   */
  async export(
    filters: AuditQueryFilters,
    format: AuditExportFormat,
  ): Promise<string> {
    // 查询所有匹配数据（导出不分页，但限制最大10000条）
    const exportFilters = { ...filters, limit: 10000, offset: 0 };
    const result = await this.query(exportFilters);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = format === 'csv' ? 'csv' : 'json';
    const filename = `audit-export-${timestamp}.${ext}`;
    const filepath = path.join(this.exportDir, filename);

    if (format === 'csv') {
      const csv = this.toCSV(result.data);
      fs.writeFileSync(filepath, csv, 'utf-8');
    } else {
      fs.writeFileSync(filepath, JSON.stringify(result.data, this.bigIntReplacer, 2), 'utf-8');
    }

    return filepath;
  }

  /**
   * 归档过期日志
   *
   * 将 createdAt < beforeDate 的日志导出为 gzip 压缩的 JSON，
   * 然后从数据库中删除已归档记录。
   */
  async archive(beforeDate?: Date): Promise<AuditArchiveResult> {
    const cutoff = beforeDate || new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);

    if (!this.prisma) {
      return { archivedCount: 0, archiveFile: '', beforeDate: cutoff };
    }

    // 1. 查询待归档记录
    const records = await this.prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
    });

    if (records.length === 0) {
      return { archivedCount: 0, archiveFile: '', beforeDate: cutoff };
    }

    // 2. 压缩写入归档文件
    const dateStr = cutoff.toISOString().slice(0, 10);
    const archiveFilename = `audit-archive-${dateStr}.json.gz`;
    const archiveFilepath = path.join(this.archiveDir, archiveFilename);

    const jsonContent = JSON.stringify(records, this.bigIntReplacer, 2);
    const compressed = zlib.gzipSync(Buffer.from(jsonContent, 'utf-8'));
    fs.writeFileSync(archiveFilepath, compressed);

    // 3. 从数据库删除已归档记录
    await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return {
      archivedCount: records.length,
      archiveFile: archiveFilepath,
      beforeDate: cutoff,
    };
  }

  /**
   * 清理过期的导出文件（超过24小时）
   */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cleaned = 0;

    if (!fs.existsSync(this.exportDir)) return 0;

    const files = fs.readdirSync(this.exportDir);
    for (const file of files) {
      const filepath = path.join(this.exportDir, file);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filepath);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 获取最近N条日志的统计摘要
   */
  async getStats(days: number = 7): Promise<{
    totalLogs: number;
    byAction: Record<string, number>;
    byUser: Record<string, number>;
    failureCount: number;
  }> {
    if (!this.prisma) {
      return { totalLogs: 0, byAction: {}, byUser: {}, failureCount: 0 };
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalLogs, failureCount, records] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: since }, success: false } }),
      this.prisma.auditLog.findMany({
        where: { createdAt: { gte: since } },
        select: { action: true, userId: true },
      }),
    ]);

    const byAction: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const r of records) {
      byAction[r.action] = (byAction[r.action] || 0) + 1;
      if (r.userId) {
        byUser[r.userId] = (byUser[r.userId] || 0) + 1;
      }
    }

    return { totalLogs, byAction, byUser, failureCount };
  }

  // ─── 内部方法 ───────────────────────────────────────

  /**
   * 构建 Prisma where 条件
   */
  private buildWhereClause(filters: AuditQueryFilters): any {
    const where: any = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.success !== undefined) {
      where.success = filters.success;
    }

    if (filters.resource) {
      where.resource = { contains: filters.resource };
    }

    if (filters.startTime || filters.endTime) {
      where.createdAt = {};
      if (filters.startTime) {
        where.createdAt.gte = new Date(filters.startTime);
      }
      if (filters.endTime) {
        where.createdAt.lte = new Date(filters.endTime);
      }
    }

    return where;
  }

  /**
   * 将日志记录转换为 CSV 格式
   */
  private toCSV(records: AuditLogRecord[]): string {
    const headers = [
      'logId', 'userId', 'username', 'action', 'resource', 'success',
      'ipAddress', 'userAgent', 'errorMessage', 'durationMs', 'createdAt',
    ];

    const lines = [headers.join(',')];

    for (const r of records) {
      const row = [
        String(r.logId),
        r.userId || '',
        r.username || '',
        r.action || '',
        this.csvEscape(r.resource || ''),
        String(r.success),
        r.ipAddress || '',
        this.csvEscape(r.userAgent || ''),
        this.csvEscape(r.errorMessage || ''),
        r.durationMs != null ? String(r.durationMs) : '',
        r.createdAt ? r.createdAt.toISOString() : '',
      ];
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  /**
   * CSV 字段转义
   */
  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * BigInt JSON 序列化处理
   */
  private bigIntReplacer(_key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }
}
