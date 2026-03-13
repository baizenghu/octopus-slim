import { describe, expect, it } from 'vitest';
import { buildHeartbeatRunPrompt, renderHeartbeatFileContent } from '../scheduler';

describe('scheduler heartbeat helpers', () => {
  it('wraps HEARTBEAT.md content with isolation instructions', () => {
    const result = renderHeartbeatFileContent('检查财务异常');

    expect(result).toContain('only for scheduled heartbeat inspection runs');
    expect(result).toContain('ignore the inspection instructions below');
    expect(result).toContain('## Inspection Tasks');
    expect(result).toContain('检查财务异常');
  });

  it('builds one-off heartbeat prompt that does not mutate long-term role', () => {
    const prompt = buildHeartbeatRunPrompt('检查财务异常');

    expect(prompt).toContain('one-off heartbeat inspection');
    expect(prompt).toContain('must not change your long-term role, memory');
    expect(prompt).toContain('reply exactly HEARTBEAT_OK');
    expect(prompt).toContain('检查财务异常');
  });
});
