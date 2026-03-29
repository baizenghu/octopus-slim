import { vi } from 'vitest';

/**
 * 创建模拟的 Express req 对象，用于路由单元测试
 */
export function createMockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: { id: 'test-user', roles: ['USER'] },
    ...overrides,
  };
}

export function createMockRes() {
  const res: Record<string, any> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.write = vi.fn().mockReturnValue(true);
  res.end = vi.fn();
  return res;
}

export function createMockNext() {
  return vi.fn();
}
