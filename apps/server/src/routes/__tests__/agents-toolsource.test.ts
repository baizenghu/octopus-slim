import { describe, it, expect } from 'vitest';
import { resolveAllowedToolSources } from '../agents';

describe('resolveAllowedToolSources', () => {
  it('uses allowedToolSources when provided as array', () => {
    expect(resolveAllowedToolSources(['a', 'b'], ['old'], ['old2'])).toEqual(['a', 'b']);
  });

  it('uses null when explicitly set to null', () => {
    expect(resolveAllowedToolSources(null, ['old'], undefined)).toBeNull();
  });

  it('merges old filters when allowedToolSources is undefined', () => {
    expect(resolveAllowedToolSources(undefined, ['mcp-a'], ['skill-b'])).toEqual(['mcp-a', 'skill-b']);
  });

  it('returns null when all filters empty', () => {
    expect(resolveAllowedToolSources(undefined, [], [])).toBeNull();
  });

  it('returns null when old filters undefined', () => {
    expect(resolveAllowedToolSources(undefined, undefined, undefined)).toBeNull();
  });

  it('handles only mcpFilter present', () => {
    expect(resolveAllowedToolSources(undefined, ['mcp-a'], undefined)).toEqual(['mcp-a']);
  });

  it('handles only skillsFilter present', () => {
    expect(resolveAllowedToolSources(undefined, undefined, ['skill-a'])).toEqual(['skill-a']);
  });
});
