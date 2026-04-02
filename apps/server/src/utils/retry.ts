/**
 * 重试工具函数 — 指数退避 + 25% jitter
 * 与 Claude Code withRetry.ts 策略对齐
 */

export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 30_000;

/**
 * 计算重试延迟（指数退避 + 25% jitter）
 * attempt=0 -> [500, 625], attempt=1 -> [1000, 1250], ...
 */
export function calcRetryDelay(attempt: number): number {
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = base * 0.25 * Math.random(); // 0~25% jitter
  return Math.round(base + jitter);
}

/**
 * 判断 HTTP/API 错误是否可重试
 * 覆盖：429 Too Many Requests, 503 Service Unavailable, 529 Overloaded,
 *       "rate limit", "overloaded", "too many requests"
 */
export function isRetryableError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('529') ||
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('too many requests')
  );
}
