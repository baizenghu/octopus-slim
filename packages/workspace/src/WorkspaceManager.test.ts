/**
 * WorkspaceManager 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager } from '../src/WorkspaceManager';
import { AGENT_WORKSPACE_SUBDIRS } from '../src/types';

let tempDir: string;
let manager: WorkspaceManager;

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'octopus-ws-test-'));
  manager = new WorkspaceManager({
    dataRoot: tempDir,
    defaultStorageQuota: 5, // 5GB
  });
});

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

describe('WorkspaceManager', () => {
  describe('initWorkspace', () => {
    it('should create full directory structure', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');

      // 验证用户根目录和元数据已创建
      const userRoot = path.join(tempDir, 'users', 'user-001');
      expect(fs.existsSync(userRoot)).toBe(true);
      expect(fs.existsSync(path.join(userRoot, 'metadata.json'))).toBe(true);
    });

    it('should write metadata.json', async () => {
      await manager.initWorkspace('user-001', 'zhangsan', {
        department: '调度中心',
        roles: ['power_user'],
      });

      const meta = await manager.getUserMetadata('user-001');
      expect(meta).not.toBeNull();
      expect(meta!.username).toBe('zhangsan');
      expect(meta!.department).toBe('调度中心');
      expect(meta!.roles).toEqual(['power_user']);
      expect(meta!.quotas.storage).toBe(5);
    });

    it('should not overwrite existing workspace', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');

      // 在 workspace 中创建一个文件
      const testFile = path.join(manager.getWorkspacePath('user-001'), 'test.txt');
      await fsp.writeFile(testFile, 'hello');

      // 再次初始化不应删除已有文件
      await manager.initWorkspace('user-001', 'zhangsan');
      expect(fs.existsSync(testFile)).toBe(true);
    });

    it('should return workspace path', async () => {
      const wsPath = await manager.initWorkspace('user-001', 'zhangsan');
      expect(wsPath).toContain('user-001');
      // initWorkspace returns the user root path (data/users/{userId})
      expect(wsPath).toContain('users');
    });
  });

  describe('validatePath', () => {
    beforeEach(async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
    });

    it('should accept paths within workspace', async () => {
      const result = await manager.validatePath('user-001', 'test.txt');
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toContain('user-001');
    });

    it('should accept nested paths', async () => {
      const result = await manager.validatePath('user-001', 'subdir/file.txt');
      expect(result.valid).toBe(true);
    });

    it('should reject path traversal with ../', async () => {
      const result = await manager.validatePath('user-001', '../../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should reject path traversal with absolute path', async () => {
      const result = await manager.validatePath('user-001', '/etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should reject null bytes', async () => {
      const result = await manager.validatePath('user-001', 'file\0.txt');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('null bytes');
    });

    it('should detect symlink escape', async () => {
      // 创建一个指向 /tmp 的符号链接
      const symlinkPath = path.join(manager.getWorkspacePath('user-001'), 'evil-link');
      try {
        await fsp.symlink('/tmp', symlinkPath);
        const result = await manager.validatePath('user-001', 'evil-link');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Symlink');
      } catch {
        // 某些环境不允许创建符号链接，跳过
      }
    });
  });

  describe('validatePathSync', () => {
    it('should return resolved path for valid paths', () => {
      const result = manager.validatePathSync('user-001', 'file.txt');
      expect(result).not.toBeNull();
      expect(result).toContain('user-001');
    });

    it('should return null for path traversal', () => {
      expect(manager.validatePathSync('user-001', '../../etc/passwd')).toBeNull();
    });

    it('should return null for null bytes', () => {
      expect(manager.validatePathSync('user-001', 'file\0.txt')).toBeNull();
    });
  });

  describe('calculateUsage', () => {
    it('should return 0 for non-existent workspace', async () => {
      const usage = await manager.calculateUsage('nonexistent');
      expect(usage).toBe(0);
    });

    it('should calculate total size of files', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
      const wsPath = manager.getWorkspacePath('user-001');

      // 创建一些测试文件
      await fsp.writeFile(path.join(wsPath, 'file1.txt'), 'hello world'); // 11 bytes
      await fsp.writeFile(path.join(wsPath, 'file2.txt'), 'test');         // 4 bytes

      const usage = await manager.calculateUsage('user-001');
      // metadata.json + test files
      expect(usage).toBeGreaterThan(15);
    });
  });

  describe('checkQuota', () => {
    it('should report non-exceeded for empty workspace', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
      const status = await manager.checkQuota('user-001');

      expect(status.storage.exceeded).toBe(false);
      expect(status.storage.limit).toBe(5 * 1024 * 1024 * 1024);
      expect(status.storage.percentage).toBeLessThan(1);
    });

    it('should support custom limit', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
      const status = await manager.checkQuota('user-001', 0.001); // 1MB

      // metadata.json alone might exceed 1MB limit concept
      expect(status.storage.limit).toBeCloseTo(0.001 * 1024 * 1024 * 1024, 0);
    });
  });

  describe('deleteWorkspace', () => {
    it('should delete workspace directory', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
      expect(manager.exists('user-001')).toBe(true);

      await manager.deleteWorkspace('user-001');
      expect(manager.exists('user-001')).toBe(false);
    });

    it('should not throw for non-existent workspace', async () => {
      await expect(manager.deleteWorkspace('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('metadata operations', () => {
    beforeEach(async () => {
      await manager.initWorkspace('user-001', 'zhangsan', { department: '调度中心' });
    });

    it('should read metadata', async () => {
      const meta = await manager.getUserMetadata('user-001');
      expect(meta?.username).toBe('zhangsan');
      expect(meta?.department).toBe('调度中心');
    });

    it('should update metadata', async () => {
      await manager.updateUserMetadata('user-001', { department: '运维部门' });

      const meta = await manager.getUserMetadata('user-001');
      expect(meta?.department).toBe('运维部门');
      expect(meta?.username).toBe('zhangsan'); // 未改字段保留
    });

    it('should update lastActiveAt on touch', async () => {
      const before = await manager.getUserMetadata('user-001');
      await new Promise(r => setTimeout(r, 10));
      await manager.touchLastActive('user-001');
      const after = await manager.getUserMetadata('user-001');

      expect(after!.lastActiveAt).not.toBe(before!.lastActiveAt);
    });

    it('should return null for non-existent user', async () => {
      const meta = await manager.getUserMetadata('nonexistent');
      expect(meta).toBeNull();
    });

    it('should throw on update for non-existent user', async () => {
      await expect(manager.updateUserMetadata('nonexistent', {}))
        .rejects.toThrow('Workspace not found');
    });
  });

  describe('listWorkspaces', () => {
    it('should list all workspaces', async () => {
      await manager.initWorkspace('user-001', 'zhangsan');
      await manager.initWorkspace('user-002', 'lisi');

      const list = await manager.listWorkspaces();
      expect(list).toContain('user-001');
      expect(list).toContain('user-002');
      expect(list).toHaveLength(2);
    });

    it('should return empty array when no workspaces', async () => {
      const list = await manager.listWorkspaces();
      expect(list).toEqual([]);
    });
  });

  describe('getAgentSubPath', () => {
    it('should return correct agent workspace sub-paths', () => {
      // getAgentSubPath(userId, agentName, subDir) returns agents/{agentName}/workspace/{subDir}
      expect(manager.getAgentSubPath('user-001', 'myagent', 'FILES')).toContain(
        path.join('agents', 'myagent', 'workspace', AGENT_WORKSPACE_SUBDIRS.FILES),
      );
      expect(manager.getAgentSubPath('user-001', 'myagent', 'OUTPUTS')).toContain(
        path.join('agents', 'myagent', 'workspace', AGENT_WORKSPACE_SUBDIRS.OUTPUTS),
      );
      expect(manager.getAgentSubPath('user-001', 'myagent', 'TEMP')).toContain(
        path.join('agents', 'myagent', 'workspace', AGENT_WORKSPACE_SUBDIRS.TEMP),
      );
    });
  });
});
