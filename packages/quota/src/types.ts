/**
 * 配额管理类型定义
 */

/** 配额类型 */
export type QuotaType = 'token_daily' | 'token_monthly' | 'request_hourly';

/** 配额检查结果 */
export interface QuotaCheckResult {
  /** 是否允许继续 */
  allowed: boolean;
  /** 剩余配额 */
  remaining: number;
  /** 配额重置时间 */
  resetAt: Date;
}

/** 用户配额使用情况 */
export interface UsageStats {
  /** 今日 token 用量 */
  tokenDaily: number;
  /** 本月 token 用量 */
  tokenMonthly: number;
  /** 本小时请求次数 */
  requestHourly: number;
  /** 各类型限额 */
  limits: Record<QuotaType, number>;
}
