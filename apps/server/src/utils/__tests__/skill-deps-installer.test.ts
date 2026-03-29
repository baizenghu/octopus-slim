import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { installSkillDeps } from '../skill-deps-installer';

describe('installSkillDeps', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-deps-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns not installed when no requirements.txt', async () => {
    const result = await installSkillDeps('/tmp/nonexistent-skill-dir-test');
    expect(result.installed).toBe(false);
    expect(result.message).toContain('No requirements.txt');
  });

  it('validates a well-formed requirements.txt without installing', async () => {
    await writeFile(path.join(tmpDir, 'requirements.txt'), 'requests==2.31.0\nnumpy>=1.24\n# a comment\n');
    const result = await installSkillDeps(tmpDir);
    expect(result.installed).toBe(true);
    expect(result.message).toContain('2 dependencies detected');
    expect(result.message).toContain('sandbox');
  });

  it('rejects requirements.txt with suspicious shell metacharacters', async () => {
    await writeFile(path.join(tmpDir, 'requirements.txt'), 'requests; rm -rf /\n');
    const result = await installSkillDeps(tmpDir);
    expect(result.installed).toBe(false);
    expect(result.message).toContain('Suspicious entries found');
  });

  it('handles empty requirements.txt (no packages)', async () => {
    await writeFile(path.join(tmpDir, 'requirements.txt'), '# only comments\n\n');
    const result = await installSkillDeps(tmpDir);
    expect(result.installed).toBe(true);
    expect(result.message).toContain('0 dependencies detected');
  });
});
