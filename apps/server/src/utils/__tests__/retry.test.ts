import { describe, it, expect } from 'vitest';
import { calcRetryDelay, isRetryableError, BASE_DELAY_MS, MAX_DELAY_MS } from '../retry.js';

describe('calcRetryDelay', () => {
  it('attempt=0 在 [BASE_DELAY_MS, BASE_DELAY_MS * 1.25] 区间', () => {
    for (let i = 0; i < 20; i++) {
      const d = calcRetryDelay(0);
      expect(d).toBeGreaterThanOrEqual(BASE_DELAY_MS);
      expect(d).toBeLessThanOrEqual(Math.round(BASE_DELAY_MS * 1.25) + 1);
    }
  });

  it('attempt=1 在 [1000, 1250] 区间', () => {
    for (let i = 0; i < 20; i++) {
      const d = calcRetryDelay(1);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(Math.round(1000 * 1.25) + 1);
    }
  });

  it('不超过 MAX_DELAY_MS * 1.25', () => {
    const d = calcRetryDelay(20);
    expect(d).toBeLessThanOrEqual(Math.round(MAX_DELAY_MS * 1.25) + 1);
  });

  it('返回正整数', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = calcRetryDelay(attempt);
      expect(d).toBeGreaterThan(0);
      expect(Number.isInteger(d)).toBe(true);
    }
  });
});

describe('isRetryableError', () => {
  it('识别 429 状态码', () => {
    expect(isRetryableError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('识别 503 状态码', () => {
    expect(isRetryableError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
  });

  it('识别 529 状态码', () => {
    expect(isRetryableError(new Error('Error 529 overloaded'))).toBe(true);
  });

  it('识别 rate limit 关键字', () => {
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('识别 overloaded 关键字', () => {
    expect(isRetryableError(new Error('claude is overloaded'))).toBe(true);
  });

  it('识别 too many requests 关键字', () => {
    expect(isRetryableError(new Error('too many requests sent'))).toBe(true);
  });

  it('不重试 400 Bad Request', () => {
    expect(isRetryableError(new Error('HTTP 400 Bad Request'))).toBe(false);
  });

  it('不重试 401 Unauthorized', () => {
    expect(isRetryableError(new Error('HTTP 401 Unauthorized'))).toBe(false);
  });

  it('不重试普通错误', () => {
    expect(isRetryableError(new Error('config changed since last load'))).toBe(false);
  });

  it('接受非 Error 字符串', () => {
    expect(isRetryableError('429 error occurred')).toBe(true);
    expect(isRetryableError('some other problem')).toBe(false);
  });
});
