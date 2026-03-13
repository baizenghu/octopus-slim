/**
 * OctopusBridge 集成测试
 *
 * 需要运行中的 Native Octopus Gateway（端口 18791）才能执行。
 * 如果 OCTOPUS_GATEWAY_TOKEN 未设置，所有测试自动跳过（CI 安全）。
 *
 * 运行方式（先启动 native gateway）：
 *   OCTOPUS_GATEWAY_TOKEN=ent-gw-secret-token-change-me \
 *   npx vitest run src/services/__tests__/OctopusBridge.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OctopusBridge } from '../OctopusBridge';

const TOKEN = process.env.OCTOPUS_GATEWAY_TOKEN;
const URL = process.env.OCTOPUS_GATEWAY_URL || 'ws://127.0.0.1:18791';

const SKIP = !TOKEN;

describe('OctopusBridge integration', () => {
  let bridge: OctopusBridge;

  beforeAll(async () => {
    if (SKIP) return;
    bridge = new OctopusBridge({ url: URL, token: TOKEN! });
    await bridge.connect();
  });

  afterAll(async () => {
    if (SKIP || !bridge) return;
    await bridge.disconnect();
  });

  it.skipIf(SKIP)('should connect to native gateway', () => {
    expect(bridge.isConnected).toBe(true);
  });

  it.skipIf(SKIP)('health RPC should return ok', async () => {
    const result = await bridge.health() as any;
    expect(result).toBeDefined();
  });

  it.skipIf(SKIP)('models.list should return array', async () => {
    const result = await bridge.modelsList() as any;
    const models = result?.models ?? result;
    expect(Array.isArray(models)).toBe(true);
  });

  it.skipIf(SKIP)('sessions.list should return array', async () => {
    const result = await bridge.sessionsList() as any;
    const sessions = result?.sessions ?? result;
    expect(Array.isArray(sessions)).toBe(true);
  });

  it.skipIf(SKIP)('cron.list should return array', async () => {
    const result = await bridge.cronList(true) as any;
    const jobs = result?.jobs ?? result;
    expect(Array.isArray(jobs)).toBe(true);
  });
});
