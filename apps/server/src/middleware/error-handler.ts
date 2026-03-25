import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('error-handler');

/**
 * 自定义应用错误，支持 HTTP 状态码
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * 全局错误处理中间件
 * - 4xx 错误: 返回具体 message（业务逻辑错误，对用户有意义）
 * - 5xx 错误: 返回通用消息，详细错误仅写日志
 */
export function globalErrorHandler(
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode || 500;

  // 记录详细错误到日志
  if (statusCode >= 500) {
    logger.error(`[error] ${_req.method} ${_req.path}: ${err.message}`, { stack: err.stack?.split('\n')[1]?.trim() });
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? '服务器内部错误，请稍后重试' : err.message,
  });
}
