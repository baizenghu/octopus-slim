import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { Request, Response, NextFunction } from 'express';

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

export const agentCallsTotal = new Counter({
  name: 'agent_calls_total',
  help: 'Total agent invocations',
  labelNames: ['agent_id', 'status'] as const,
  registers: [register],
});

/**
 * Express 中间件: 记录每个请求的耗时和状态码
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use route pattern if available, otherwise normalize path to avoid high cardinality
  const end = httpRequestDuration.startTimer({ method: req.method, path: req.route?.path || req.path });
  res.on('finish', () => {
    end();
    httpRequestsTotal.inc({
      method: req.method,
      path: req.route?.path || req.path,
      status: String(res.statusCode),
    });
  });
  next();
}
