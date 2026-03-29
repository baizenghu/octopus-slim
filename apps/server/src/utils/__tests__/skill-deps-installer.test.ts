import { describe, it, expect } from 'vitest';
import { installSkillDeps } from '../skill-deps-installer';

describe('installSkillDeps', () => {
  it('returns not installed when no requirements.txt', async () => {
    const result = await installSkillDeps('/tmp/nonexistent-skill-dir-test');
    expect(result.installed).toBe(false);
    expect(result.message).toContain('No requirements.txt');
  });
});
