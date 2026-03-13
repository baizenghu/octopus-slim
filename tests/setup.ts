/**
 * 测试全局初始化
 * 在所有测试运行前执行
 */
import { beforeAll, afterAll, vi } from 'vitest';

// Mock 环境变量
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'octopus';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'octopus_test';
process.env.DATABASE_URL = 'mysql://octopus:test@localhost:3306/octopus_test';

process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_PASSWORD = '';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '2h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

process.env.LDAP_MOCK_ENABLED = 'true';

process.env.OPENAI_API_BASE = 'https://api.deepseek.com';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_MODEL = 'deepseek-chat';

process.env.DATA_ROOT = '/tmp/octopus-test-data';

beforeAll(() => {
  // 清理测试数据目录
  console.log('[test setup] Test environment initialized');
});

afterAll(() => {
  // 清理资源
  vi.restoreAllMocks();
  console.log('[test setup] Test environment cleaned up');
});
