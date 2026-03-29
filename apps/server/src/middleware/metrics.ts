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
 * Normalize request path for metrics labels to avoid high cardinality.
 * Replaces dynamic segments with placeholders.
 */
function normalizePath(req: Request): string {
  // Use route pattern if available (best case)
  if (req.route?.path) return req.route.path;

  // Normalize known dynamic patterns
  const path = req.path;
  return path
    .replace(/\/ent_[^/]+/g, '/:id')           // Agent IDs: ent_user_name
    .replace(/\/usr_[^/]+/g, '/:id')           // User tool source IDs
    .replace(/\/[0-9a-f-]{36}/g, '/:uuid')     // UUIDs
    .replace(/\/\d+/g, '/:num');                // Numeric IDs
}

/**
 * Express 中间件: 记录每个请求的耗时和状态码
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Normalize path to avoid high cardinality metrics
  const normalizedPath = normalizePath(req);
  const end = httpRequestDuration.startTimer({ method: req.method, path: normalizedPath });
  res.on('finish', () => {
    end();
    httpRequestsTotal.inc({
      method: req.method,
      path: normalizedPath,
      status: String(res.statusCode),
    });
  });
  next();
}
