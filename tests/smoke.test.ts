/**
 * 基础设施冒烟测试
 * 验证测试框架和环境变量正常工作
 */
import { describe, it, expect } from 'vitest';

describe('Test Infrastructure', () => {
  it('should have test environment variables set', () => {
    expect(process.env.DB_HOST).toBe('localhost');
    expect(process.env.DB_PORT).toBe('3306');
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.LDAP_MOCK_ENABLED).toBe('true');
  });

  it('should have DeepSeek API config set', () => {
    expect(process.env.OPENAI_API_BASE).toBe('https://api.deepseek.com');
    expect(process.env.OPENAI_MODEL).toBe('deepseek-chat');
  });

  it('should have DATA_ROOT set to test directory', () => {
    expect(process.env.DATA_ROOT).toBe('/tmp/octopus-test-data');
  });
});

describe('Basic TypeScript', () => {
  it('should support async/await', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });

  it('should support JSON type operations', () => {
    const roles = JSON.parse('["ADMIN","USER"]');
    expect(roles).toEqual(['ADMIN', 'USER']);
    expect(roles).toContain('ADMIN');
  });
});
