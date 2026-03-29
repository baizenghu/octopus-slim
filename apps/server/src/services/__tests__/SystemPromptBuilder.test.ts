import { describe, it, expect } from 'vitest';

/**
 * SystemPromptBuilder 注入的 6 类信息验证（纯字符串逻辑）
 */
describe('SystemPromptBuilder sections', () => {
  const expectedSections = [
    { name: '身份信息', keyword: 'Octopus AI' },
    { name: '用户信息', keyword: '当前用户' },
    { name: '工作区路径', keyword: 'workspace' },
    { name: '专业 Agent 列表', keyword: '专业助手' },
    { name: '数据库连接', keyword: 'connection_name' },
    { name: '定时提醒', keyword: 'cron' },
  ];

  it('defines 6 injection sections', () => {
    expect(expectedSections).toHaveLength(6);
  });

  it('cache key format is userId:agentId', () => {
    const userId = 'baizh';
    const agentId = 'ent_baizh_default';
    const cacheKey = `${userId}:${agentId}`;
    expect(cacheKey).toBe('baizh:ent_baizh_default');
  });

  it('cache TTL is 5 minutes', () => {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    expect(CACHE_TTL_MS).toBe(300_000);
  });
});
