import { describe, it, expect } from 'vitest';

/**
 * 旧字段 → allowedToolSources 迁移逻辑：
 * - 有 allowedToolSources → 直接使用
 * - 无 allowedToolSources，有旧字段 → 合并 mcpFilter + skillsFilter
 * - 全部为空 → null（全部可用）
 */
export function resolveAllowedToolSources(
  allowedToolSources: string[] | null | undefined,
  mcpFilter: string[] | null | undefined,
  skillsFilter: string[] | null | undefined,
): string[] | null {
  if (allowedToolSources !== undefined) {
    return allowedToolSources;
  }
  const mcpNames = Array.isArray(mcpFilter) ? mcpFilter : [];
  const skillNames = Array.isArray(skillsFilter) ? skillsFilter : [];
  if (mcpNames.length === 0 && skillNames.length === 0) {
    return null;
  }
  return [...mcpNames, ...skillNames];
}

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
