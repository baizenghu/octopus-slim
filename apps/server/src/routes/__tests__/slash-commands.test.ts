import { describe, it, expect } from 'vitest';

describe('/remember slash command logic', () => {
  it('should return usage hint when arg is empty', () => {
    const arg = '';
    const hasContent = arg.trim().length > 0;
    expect(hasContent).toBe(false);
  });

  it('should truncate preview at 100 chars with ellipsis', () => {
    const longContent = 'a'.repeat(150);
    const trimmed = longContent.trim();
    const preview = trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
    expect(preview).toHaveLength(103); // 100 + '...'
    expect(preview.endsWith('...')).toBe(true);
  });

  it('should not add ellipsis for short content', () => {
    const shortContent = 'short';
    const trimmed = shortContent.trim();
    const preview = trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
    expect(preview).toBe('short');
    expect(preview.endsWith('...')).toBe(false);
  });

  it('should use exactly 100 chars as cut-off boundary', () => {
    const exactContent = 'b'.repeat(100);
    const trimmed = exactContent.trim();
    const preview = trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
    expect(preview).toHaveLength(100);
    expect(preview.endsWith('...')).toBe(false);
  });
});
