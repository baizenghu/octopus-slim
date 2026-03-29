import { describe, it, expect } from 'vitest';

describe('system-config API key masking', () => {
  function maskApiKey(key: string): string {
    if (!key) return '********';
    return key.length > 12
      ? `${key.slice(0, 4)}****${key.slice(-4)}`
      : '********';
  }

  it('masks long API key showing first 4 and last 4', () => {
    const masked = maskApiKey('YOUR_DEEPSEEK_API_KEY');
    expect(masked).toBe('sk-9****76e4');
  });

  it('fully masks short API key', () => {
    const masked = maskApiKey('short-key');
    expect(masked).toBe('********');
  });

  it('fully masks empty API key', () => {
    const masked = maskApiKey('');
    expect(masked).toBe('********');
  });

  function isMasked(value: string): boolean {
    return value.includes('****');
  }

  it('detects masked values correctly', () => {
    expect(isMasked('sk-9****76e4')).toBe(true);
    expect(isMasked('sk-real-key-here')).toBe(false);
  });
});
