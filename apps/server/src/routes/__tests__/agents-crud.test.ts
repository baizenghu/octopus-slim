import { describe, it, expect } from 'vitest';

/**
 * Agent 名称验证规则（从 agents.ts 提取的纯逻辑）:
 * - 只允许中文、英文、数字、-、_
 * - 长度 1-50
 */
const AGENT_NAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_-]{1,50}$/;

describe('Agent name validation', () => {
  it('accepts valid Chinese name', () => {
    expect(AGENT_NAME_RE.test('财务助手')).toBe(true);
  });

  it('accepts valid English name', () => {
    expect(AGENT_NAME_RE.test('code-reviewer')).toBe(true);
  });

  it('accepts alphanumeric with underscore', () => {
    expect(AGENT_NAME_RE.test('agent_v2')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(AGENT_NAME_RE.test('')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(AGENT_NAME_RE.test('agent@hack')).toBe(false);
    expect(AGENT_NAME_RE.test('../etc/passwd')).toBe(false);
  });

  it('rejects string longer than 50 chars', () => {
    expect(AGENT_NAME_RE.test('a'.repeat(51))).toBe(false);
  });
});

/**
 * Agent ID 格式规则:
 * - 格式: ent_{userId}_{agentName}
 */
describe('Agent ID format', () => {
  function buildAgentId(userId: string, name: string): string {
    return `ent_${userId}_${name}`;
  }

  it('builds correct ID for standard user', () => {
    expect(buildAgentId('baizh', 'default')).toBe('ent_baizh_default');
  });

  it('extracts userId from agent ID', () => {
    const id = 'ent_baizh_code-reviewer';
    const parts = id.split('_');
    const userId = parts[1];
    expect(userId).toBe('baizh');
  });
});
