import { describe, expect, it } from 'vitest';
import { buildHeartbeatRunPrompt } from '../scheduler';

describe('scheduler heartbeat helpers', () => {
  it('builds one-off heartbeat prompt that does not mutate long-term role', () => {
    const prompt = buildHeartbeatRunPrompt('检查财务异常');

    expect(prompt).toContain('one-off heartbeat inspection');
    expect(prompt).toContain('must not change your long-term role, memory');
    expect(prompt).toContain('reply exactly HEARTBEAT_OK');
    expect(prompt).toContain('检查财务异常');
  });

  it('returns minimal prompt when content is empty', () => {
    const prompt = buildHeartbeatRunPrompt('');

    expect(prompt).toContain('one-off heartbeat inspection');
    expect(prompt).toContain('HEARTBEAT_OK');
    expect(prompt).not.toContain('检查');
  });
});
