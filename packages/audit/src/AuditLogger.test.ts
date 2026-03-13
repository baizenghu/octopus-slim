/**
 * AuditLogger 单元测试
 *
 * 使用 Mock Prisma Client 测试：
 * - 日志写入（双写：文件 + 数据库）
 * - 日志查询（多条件过滤 + 分页）
 * - 日志导出（CSV / JSON）
 * - 日志归档（gzip 压缩 + 数据库删除）
 * - 导出文件清理
 * - 错误隔离（数据库失败不影响文件写入）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { AuditLogger } from './AuditLogger';
import { AuditAction } from './types';
import type { AuditLoggerConfig, AuditLogEntry } from './types';

// 测试用临时目录
const TEST_LOG_DIR = '/tmp/octopus-audit-test-' + Date.now();

/** 创建 Mock Prisma Client */
function createMockPrisma() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({ logId: BigInt(1) }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any;
}

/** 创建测试用审计日志条目 */
function createTestEntry(overrides?: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    userId: 'user-001',
    username: 'zhangsan',
    action: AuditAction.AUTH_LOGIN,
    resource: 'user:zhangsan',
    details: { method: 'POST', url: '/api/auth/login' },
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0',
    success: true,
    durationMs: 150,
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let config: AuditLoggerConfig;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    config = {
      logDir: TEST_LOG_DIR,
      retentionDays: 30,
      enableDatabase: true,
      prisma: mockPrisma,
    };
    auditLogger = new AuditLogger(config);
  });

  afterEach(async () => {
    // 先关闭 Winston 日志器，释放文件句柄
    await auditLogger.close();
    // 再清理测试目录
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    }
  });

  // ─── 日志写入 ───────────────────────────────────────

  describe('log()', () => {
    it('should write to database via Prisma', async () => {
      const entry = createTestEntry();
      await auditLogger.log(entry);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledOnce();

      const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(createArg.data.userId).toBe('user-001');
      expect(createArg.data.action).toBe(AuditAction.AUTH_LOGIN);
      expect(createArg.data.resource).toBe('user:zhangsan');
      expect(createArg.data.ipAddress).toBe('192.168.1.100');
      expect(createArg.data.success).toBe(true);
      expect(createArg.data.durationMs).toBe(150);
    });

    it('should create log directory structure', async () => {
      expect(fs.existsSync(TEST_LOG_DIR)).toBe(true);
      expect(fs.existsSync(path.join(TEST_LOG_DIR, 'exports'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_LOG_DIR, 'archive'))).toBe(true);
    });

    it('should handle missing optional fields', async () => {
      const entry = createTestEntry({
        resource: undefined,
        details: undefined,
        ipAddress: undefined,
        userAgent: undefined,
        errorMessage: undefined,
        durationMs: undefined,
      });

      await auditLogger.log(entry);

      const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(createArg.data.resource).toBeNull();
      expect(createArg.data.ipAddress).toBeNull();
      expect(createArg.data.userAgent).toBeNull();
    });

    it('should not throw when database write fails', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB connection lost'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(auditLogger.log(createTestEntry())).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AuditLogger] Database write failed:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('should work without database (file-only mode)', async () => {
      const fileOnlyLogger = new AuditLogger({
        ...config,
        enableDatabase: false,
        prisma: undefined,
      });

      await expect(fileOnlyLogger.log(createTestEntry())).resolves.not.toThrow();
      // Prisma should not be called
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('should record failed operations', async () => {
      const entry = createTestEntry({
        action: AuditAction.AUTH_LOGIN_FAILED,
        success: false,
        errorMessage: 'Invalid password',
      });

      await auditLogger.log(entry);

      const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(createArg.data.success).toBe(false);
      expect(createArg.data.errorMessage).toBe('Invalid password');
    });
  });

  // ─── 日志查询 ───────────────────────────────────────

  describe('query()', () => {
    const mockRecords = [
      {
        logId: BigInt(1),
        userId: 'user-001',
        action: 'auth:login',
        resource: 'user:zhangsan',
        details: { method: 'POST' },
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        success: true,
        errorMessage: null,
        durationMs: 120,
        createdAt: new Date('2026-02-10T10:00:00Z'),
      },
      {
        logId: BigInt(2),
        userId: 'user-002',
        action: 'session:message',
        resource: 'session:default',
        details: null,
        ipAddress: '10.0.0.1',
        userAgent: null,
        success: true,
        errorMessage: null,
        durationMs: null,
        createdAt: new Date('2026-02-10T11:00:00Z'),
      },
    ];

    beforeEach(() => {
      mockPrisma.auditLog.findMany.mockResolvedValue(mockRecords);
      mockPrisma.auditLog.count.mockResolvedValue(2);
    });

    it('should return paginated results', async () => {
      const result = await auditLogger.query({ limit: 10, offset: 0 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(10);
    });

    it('should pass userId filter to Prisma', async () => {
      await auditLogger.query({ userId: 'user-001' });

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg.userId).toBe('user-001');
    });

    it('should pass action filter to Prisma', async () => {
      await auditLogger.query({ action: AuditAction.AUTH_LOGIN });

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg.action).toBe('auth:login');
    });

    it('should pass time range filter to Prisma', async () => {
      await auditLogger.query({
        startTime: '2026-02-10T00:00:00Z',
        endTime: '2026-02-10T23:59:59Z',
      });

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg.createdAt.gte).toEqual(new Date('2026-02-10T00:00:00Z'));
      expect(whereArg.createdAt.lte).toEqual(new Date('2026-02-10T23:59:59Z'));
    });

    it('should respect order direction', async () => {
      await auditLogger.query({ orderBy: 'asc' });

      const orderByArg = mockPrisma.auditLog.findMany.mock.calls[0][0].orderBy;
      expect(orderByArg.createdAt).toBe('asc');
    });

    it('should cap limit at 500', async () => {
      await auditLogger.query({ limit: 9999 });

      const takeArg = mockPrisma.auditLog.findMany.mock.calls[0][0].take;
      expect(takeArg).toBe(500);
    });

    it('should default to limit=50 and orderBy=desc', async () => {
      await auditLogger.query({});

      const call = mockPrisma.auditLog.findMany.mock.calls[0][0];
      expect(call.take).toBe(50);
      expect(call.orderBy.createdAt).toBe('desc');
    });

    it('should return empty result when database disabled', async () => {
      const fileOnlyLogger = new AuditLogger({
        ...config,
        enableDatabase: false,
        prisma: undefined,
      });

      const result = await fileOnlyLogger.query({});
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should convert records to AuditLogRecord format', async () => {
      const result = await auditLogger.query({});

      expect(result.data[0].logId).toBe(BigInt(1));
      expect(result.data[0].action).toBe('auth:login');
      expect(result.data[0].createdAt).toEqual(new Date('2026-02-10T10:00:00Z'));
      expect(result.data[1].durationMs).toBeUndefined();
    });
  });

  // ─── 日志导出 ───────────────────────────────────────

  describe('export()', () => {
    const mockRecords = [
      {
        logId: BigInt(1),
        userId: 'user-001',
        action: 'auth:login',
        resource: 'user:zhangsan',
        details: { method: 'POST' },
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        success: true,
        errorMessage: null,
        durationMs: 120,
        createdAt: new Date('2026-02-10T10:00:00Z'),
      },
    ];

    beforeEach(() => {
      mockPrisma.auditLog.findMany.mockResolvedValue(mockRecords);
      mockPrisma.auditLog.count.mockResolvedValue(1);
    });

    it('should export CSV file', async () => {
      const filepath = await auditLogger.export({}, 'csv');

      expect(filepath).toContain('.csv');
      expect(fs.existsSync(filepath)).toBe(true);

      const content = fs.readFileSync(filepath, 'utf-8');
      expect(content).toContain('logId,userId,action');
      expect(content).toContain('user-001');
      expect(content).toContain('auth:login');
    });

    it('should export JSON file', async () => {
      const filepath = await auditLogger.export({}, 'json');

      expect(filepath).toContain('.json');
      expect(fs.existsSync(filepath)).toBe(true);

      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].action).toBe('auth:login');
    });

    it('should place export files in exports directory', async () => {
      const filepath = await auditLogger.export({}, 'csv');
      expect(filepath).toContain(path.join(TEST_LOG_DIR, 'exports'));
    });

    it('should pass filters to query', async () => {
      await auditLogger.export({ userId: 'user-001' }, 'csv');

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg.userId).toBe('user-001');
    });

    it('should handle CSV special characters', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{
        ...mockRecords[0],
        resource: 'file:test,with"quotes',
        userAgent: 'Agent with, comma',
      }]);

      const filepath = await auditLogger.export({}, 'csv');
      const content = fs.readFileSync(filepath, 'utf-8');

      // CSV 转义：包含逗号/引号的字段应被双引号包裹
      expect(content).toContain('"file:test,with""quotes"');
    });
  });

  // ─── 日志归档 ───────────────────────────────────────

  describe('archive()', () => {
    it('should archive old records to gzip file', async () => {
      const oldRecords = [
        {
          logId: BigInt(1),
          userId: 'user-001',
          action: 'auth:login',
          resource: null,
          details: null,
          ipAddress: '10.0.0.1',
          userAgent: null,
          success: true,
          errorMessage: null,
          durationMs: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      mockPrisma.auditLog.findMany.mockResolvedValue(oldRecords);
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 1 });

      const result = await auditLogger.archive(new Date('2026-02-01'));

      expect(result.archivedCount).toBe(1);
      expect(result.archiveFile).toContain('.json.gz');
      expect(fs.existsSync(result.archiveFile)).toBe(true);

      // 验证 gzip 内容可解压
      const compressed = fs.readFileSync(result.archiveFile);
      const decompressed = zlib.gunzipSync(compressed).toString('utf-8');
      const parsed = JSON.parse(decompressed);
      expect(parsed).toHaveLength(1);
    });

    it('should delete archived records from database', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{
        logId: BigInt(1),
        userId: 'u1',
        action: 'auth:login',
        resource: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        success: true,
        errorMessage: null,
        durationMs: null,
        createdAt: new Date('2025-12-01'),
      }]);
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 1 });

      await auditLogger.archive(new Date('2026-01-01'));

      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date('2026-01-01') } },
      });
    });

    it('should return zero when no records to archive', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      const result = await auditLogger.archive(new Date('2026-02-01'));
      expect(result.archivedCount).toBe(0);
      expect(result.archiveFile).toBe('');
    });

    it('should use retentionDays as default cutoff', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await auditLogger.archive();

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      const cutoff = whereArg.createdAt.lt;
      // 默认30天前，允许1秒误差
      const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
    });
  });

  // ─── 清理 ───────────────────────────────────────────

  describe('cleanup()', () => {
    it('should delete export files older than 24 hours', async () => {
      const exportsDir = path.join(TEST_LOG_DIR, 'exports');

      // 创建一个"旧"文件
      const oldFile = path.join(exportsDir, 'old-export.csv');
      fs.writeFileSync(oldFile, 'test');
      // 修改时间为 2 天前
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

      // 创建一个"新"文件
      const newFile = path.join(exportsDir, 'new-export.csv');
      fs.writeFileSync(newFile, 'test');

      const cleaned = await auditLogger.cleanup();

      expect(cleaned).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    it('should return 0 when no files to clean', async () => {
      const cleaned = await auditLogger.cleanup();
      expect(cleaned).toBe(0);
    });
  });

  // ─── 统计 ───────────────────────────────────────────

  describe('getStats()', () => {
    it('should aggregate stats from database', async () => {
      mockPrisma.auditLog.count
        .mockResolvedValueOnce(100) // totalLogs
        .mockResolvedValueOnce(5);  // failureCount

      mockPrisma.auditLog.findMany.mockResolvedValue([
        { action: 'auth:login', userId: 'user-001' },
        { action: 'auth:login', userId: 'user-002' },
        { action: 'session:message', userId: 'user-001' },
      ]);

      const stats = await auditLogger.getStats(7);

      expect(stats.totalLogs).toBe(100);
      expect(stats.failureCount).toBe(5);
      expect(stats.byAction['auth:login']).toBe(2);
      expect(stats.byAction['session:message']).toBe(1);
      expect(stats.byUser['user-001']).toBe(2);
      expect(stats.byUser['user-002']).toBe(1);
    });

    it('should return empty stats when database disabled', async () => {
      const fileOnlyLogger = new AuditLogger({
        ...config,
        enableDatabase: false,
        prisma: undefined,
      });

      const stats = await fileOnlyLogger.getStats();
      expect(stats.totalLogs).toBe(0);
      expect(stats.byAction).toEqual({});
    });
  });
});
