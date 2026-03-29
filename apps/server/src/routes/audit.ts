/**
 * 审计日志 API 路由
 *
 * GET  /api/audit/logs      - 查询审计日志（需 ADMIN 权限）
 * GET  /api/audit/export    - 导出审计日志（需 ADMIN 权限）
 * POST /api/audit/archive   - 手动触发归档（需 ADMIN 权限）
 * GET  /api/audit/stats     - 获取日志统计（需 ADMIN 权限）
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import type { AuditLogger } from '@octopus/audit';
import { AuditAction } from '@octopus/audit';
import type { AuditExportFormat, AuditQueryFilters } from '@octopus/audit';
import { createAuthMiddleware, adminOnly, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import { getRuntimeConfig } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('audit');

export function createAuditRouter(authService: AuthService, auditLogger: AuditLogger, prisma?: any): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  /**
   * 查询审计日志
   * GET /api/audit/logs?userId=&action=&startTime=&endTime=&success=&limit=&offset=
   */
  router.get('/logs', authMiddleware, adminOnly, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const filters: AuditQueryFilters = {
      userId: req.query.userId as string,
      action: req.query.action as AuditAction,
      startTime: req.query.startTime as string,
      endTime: req.query.endTime as string,
      success: req.query.success !== undefined ? req.query.success === 'true' : undefined,
      resource: req.query.resource as string,
      limit: Math.min(
        req.query.limit ? parseInt(req.query.limit as string, 10) : getRuntimeConfig().admin.defaultAuditQueryLimit,
        getRuntimeConfig().admin.maxPageSize,
      ),
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      orderBy: (req.query.orderBy as 'asc' | 'desc') || 'desc',
    };

    const result = await auditLogger.query(filters);

    // 序列化 BigInt 为字符串
    const serialized = {
      ...result,
      data: result.data.map((r: any) => ({
        ...r,
        logId: r.logId.toString(),
      })),
    };

    res.json(serialized);
  }));

  /**
   * 导出审计日志
   * GET /api/audit/export?format=csv|json&userId=&startTime=&endTime=
   */
  router.get('/export', authMiddleware, adminOnly, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const format = (req.query.format as AuditExportFormat) || 'csv';
    if (!['csv', 'json'].includes(format)) {
      res.status(400).json({ error: 'format must be csv or json' });
      return;
    }

    const filters: AuditQueryFilters = {
      userId: req.query.userId as string,
      action: req.query.action as AuditAction,
      startTime: req.query.startTime as string,
      endTime: req.query.endTime as string,
      success: req.query.success !== undefined ? req.query.success === 'true' : undefined,
    };

    const filepath = await auditLogger.export(filters, format);

    // 记录导出操作审计
    auditLogger.log({
      userId: req.user!.id,
      username: req.user!.username,
      action: AuditAction.AUDIT_EXPORT,
      resource: `export:${format}`,
      details: { filters },
      ipAddress: req.ip || 'unknown',
      success: true,
    }).catch(err => logger.warn('记录审计导出操作日志失败', { error: (err as Error)?.message || String(err) }));

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = filepath.split('/').pop() || `audit-export.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filepath);
  }));

  /**
   * 手动触发日志归档
   * POST /api/audit/archive { beforeDate?: string }
   */
  router.post('/archive', authMiddleware, adminOnly, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const beforeDate = req.body.beforeDate ? new Date(req.body.beforeDate) : undefined;
    const result = await auditLogger.archive(beforeDate);

    // 记录归档操作审计
    auditLogger.log({
      userId: req.user!.id,
      username: req.user!.username,
      action: AuditAction.AUDIT_ARCHIVE,
      resource: `archive:${result.archiveFile}`,
      details: { archivedCount: result.archivedCount },
      ipAddress: req.ip || 'unknown',
      success: true,
    }).catch(err => logger.warn('记录审计归档操作日志失败', { error: (err as Error)?.message || String(err) }));

    res.json({
      message: `Archived ${result.archivedCount} records`,
      ...result,
      beforeDate: result.beforeDate.toISOString(),
    });
  }));

  /**
   * 获取审计日志统计
   * GET /api/audit/stats?days=7
   */
  router.get('/stats', authMiddleware, adminOnly, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
    const stats = await auditLogger.getStats(days);
    res.json(stats);
  }));

  return router;
}
