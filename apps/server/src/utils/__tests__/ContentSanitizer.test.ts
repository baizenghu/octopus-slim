import { describe, it, expect } from 'vitest';
import {
  sanitizeUserContent,
  sanitizeAssistantContent,
  sanitizeResponse,
  isInternalMessage,
} from '../ContentSanitizer';

describe('sanitizeUserContent', () => {
  it('strips <relevant-memories> tags and content', () => {
    const input = 'Hello <relevant-memories>secret stuff</relevant-memories> world';
    expect(sanitizeUserContent(input)).toBe('Hello  world');
  });

  it('strips [UNTRUSTED DATA ... END UNTRUSTED DATA] blocks', () => {
    const input = 'Before [UNTRUSTED DATA some junk here [END UNTRUSTED DATA] After';
    expect(sanitizeUserContent(input)).toBe('Before  After');
  });

  it('strips timestamp prefix', () => {
    const input = '[Tue 2026-03-24 22:28 PDT] Hello there';
    expect(sanitizeUserContent(input)).toBe('Hello there');
  });

  it('strips skill injection prefixes', () => {
    expect(sanitizeUserContent('[请使用 weather skill] 今天天气怎样')).toBe('今天天气怎样');
    expect(sanitizeUserContent('[请严格按照 coding-agent skill] 写代码')).toBe('写代码');
    expect(sanitizeUserContent('[请优先使用 gemini skill] 搜索一下')).toBe('搜索一下');
  });

  it('strips /lesson prefix', () => {
    expect(sanitizeUserContent('/lesson This is a lesson')).toBe('This is a lesson');
  });

  it('strips attachment prefix', () => {
    const input = '[用户上传了 3 个文件，已保存到工作空间]\n- file1.txt\n- file2.txt\n- file3.txt\nActual message';
    expect(sanitizeUserContent(input)).toBe('Actual message');
  });

  it('strips multiple tags at once', () => {
    const input = '[Tue 2026-03-24 22:28 PDT] <relevant-memories>mem</relevant-memories>Hello [UNTRUSTED DATA x [END UNTRUSTED DATA]';
    expect(sanitizeUserContent(input)).toBe('Hello');
  });

  it('strips <context-note> tags and content', () => {
    const input = '<context-note>\n当前用户: baizh\n工作区路径: /home/...\n</context-note>\n\n帮我算工资';
    expect(sanitizeUserContent(input)).toBe('帮我算工资');
  });

  it('strips context-note with nested content', () => {
    const input = '<context-note>\n可委派的专业 Agent:\n- **小财**（agent 名称: caiwu_1）\n</context-note>\n\n你好';
    expect(sanitizeUserContent(input)).toBe('你好');
  });

  it('leaves clean content unchanged', () => {
    expect(sanitizeUserContent('Just a normal message')).toBe('Just a normal message');
  });
});

describe('sanitizeAssistantContent', () => {
  it('strips <enterprise-reminder> tags', () => {
    const input = 'Hello <enterprise-reminder delay_seconds="180" message="test" /> world';
    const result = sanitizeAssistantContent(input);
    expect(result.content).toBe('Hello  world');
  });

  it('extracts <thinking> content', () => {
    const input = '<thinking>my thoughts</thinking>The answer is 42';
    const result = sanitizeAssistantContent(input);
    expect(result.thinking).toBe('my thoughts');
    expect(result.content).toBe('The answer is 42');
  });

  it('extracts <think> content (DeepSeek format)', () => {
    const input = '<think>reasoning here</think>Result';
    const result = sanitizeAssistantContent(input);
    expect(result.thinking).toBe('reasoning here');
    expect(result.content).toBe('Result');
  });

  it('extracts <thought> content', () => {
    const input = '<thought>pondering</thought>Answer';
    const result = sanitizeAssistantContent(input);
    expect(result.thinking).toBe('pondering');
    expect(result.content).toBe('Answer');
  });

  it('extracts <antthinking> content', () => {
    const input = '<antthinking>deep thought</antthinking>Response';
    const result = sanitizeAssistantContent(input);
    expect(result.thinking).toBe('deep thought');
    expect(result.content).toBe('Response');
  });

  it('merges multiple thinking blocks', () => {
    const input = '<thinking>part1</thinking>middle<thinking>part2</thinking>end';
    const result = sanitizeAssistantContent(input);
    expect(result.thinking).toBe('part1\npart2');
    expect(result.content).toBe('middleend');
  });

  it('returns undefined thinking when none present', () => {
    const result = sanitizeAssistantContent('Just a response');
    expect(result.thinking).toBeUndefined();
    expect(result.content).toBe('Just a response');
  });

  it('removes thinking tags from content after extraction', () => {
    const input = '<thinking>secret</thinking>visible';
    const result = sanitizeAssistantContent(input);
    expect(result.content).not.toContain('thinking');
    expect(result.content).not.toContain('secret');
  });
});

describe('sanitizeResponse', () => {
  it('strips memory tags', () => {
    const input = 'Hello <relevant-memories>mem</relevant-memories> world';
    expect(sanitizeResponse(input)).toBe('Hello  world');
  });

  it('strips global timestamps across multiple lines', () => {
    const input = '[Tue 2026-03-24 22:28 PDT] Line 1\n[Wed 2026-03-25 10:00 PDT] Line 2';
    expect(sanitizeResponse(input)).toBe('Line 1\nLine 2');
  });

  it('strips untrusted data tags', () => {
    const input = 'Before [UNTRUSTED DATA stuff [END UNTRUSTED DATA] After';
    expect(sanitizeResponse(input)).toBe('Before  After');
  });
});

describe('isInternalMessage', () => {
  it('detects "Octopus runtime context"', () => {
    expect(isInternalMessage('This contains Octopus runtime context info')).toBe(true);
  });

  it('detects "[Internal task completion event]"', () => {
    expect(isInternalMessage('[Internal task completion event] done')).toBe(true);
  });

  it('returns false for normal messages', () => {
    expect(isInternalMessage('Hello, how are you?')).toBe(false);
  });
});
