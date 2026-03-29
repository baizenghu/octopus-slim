import { describe, it, expect } from 'vitest';

describe('health check status code logic', () => {
  function computeHealthResponse(gateway: 'running' | 'stopped', db: 'connected' | 'error') {
    const overallStatus = (gateway === 'stopped' || db === 'error') ? 'degraded' : 'ok';
    const httpStatus = overallStatus === 'ok' ? 200 : 503;
    return { httpStatus, overallStatus };
  }

  it('returns 200 when all services healthy', () => {
    const { httpStatus, overallStatus } = computeHealthResponse('running', 'connected');
    expect(httpStatus).toBe(200);
    expect(overallStatus).toBe('ok');
  });

  it('returns 503 when gateway is stopped', () => {
    const { httpStatus, overallStatus } = computeHealthResponse('stopped', 'connected');
    expect(httpStatus).toBe(503);
    expect(overallStatus).toBe('degraded');
  });

  it('returns 503 when database is in error', () => {
    const { httpStatus, overallStatus } = computeHealthResponse('running', 'error');
    expect(httpStatus).toBe(503);
    expect(overallStatus).toBe('degraded');
  });

  it('returns 503 when both services are down', () => {
    const { httpStatus, overallStatus } = computeHealthResponse('stopped', 'error');
    expect(httpStatus).toBe(503);
    expect(overallStatus).toBe('degraded');
  });
});
