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
    await expect(wm.enforceQuota('user-test')).resolves.toBeUndefined();
  });

  it('should throw when over quota', async () => {
    await wm.initWorkspace('user-test', 'test');
    const bigFile = path.join(wm.getWorkspacePath('user-test'), 'big.bin');
    await fsp.writeFile(bigFile, Buffer.alloc(2 * 1024 * 1024));
    await expect(wm.enforceQuota('user-test')).rejects.toThrow('存储配额已超限');
  });

  it('should respect custom quota', async () => {
    await wm.initWorkspace('user-test', 'test');
    const bigFile = path.join(wm.getWorkspacePath('user-test'), 'big.bin');
    await fsp.writeFile(bigFile, Buffer.alloc(2 * 1024 * 1024));
    await expect(wm.enforceQuota('user-test', 10)).resolves.toBeUndefined();
  });
});
