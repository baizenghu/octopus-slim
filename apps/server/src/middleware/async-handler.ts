import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * 包装 async route handler，确保 rejected promise 传递给 Express 全局错误中间件。
 * 用法: router.get('/path', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
