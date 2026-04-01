import { describe, it, expect } from 'vitest';
import { generateSkillMd, mergeSkillMd } from '../skill-md-generator';

describe('generateSkillMd', () => {
  it('generates frontmatter with command-dispatch: tool', () => {
    const result = generateSkillMd({
      name: 'echarts-visualization',
      description: '智能可视化分析',
      scope: 'enterprise',
      ownerId: null,
      command: 'python3',
      scriptPath: 'scripts/main.py',
    });
    expect(result).toContain('name: echarts-visualization');
    expect(result).toContain('description: 智能可视化分析');
    expect(result).toContain('command-dispatch: tool');
    expect(result).toContain('command-tool: run_skill');
    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/\n---\n$/);
  });

  it('personal skill uses scoped name with quotes', () => {
    const result = generateSkillMd({
      name: '数据分析',
      description: '分析数据',
      scope: 'personal',
      ownerId: 'user-baizh',
    });
    expect(result).toContain('name: "数据分析:user-b"');
  });

  it('includes version when provided', () => {
    const result = generateSkillMd({
      name: 'test',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
      version: '2.0.0',
    });
    expect(result).toContain('version: 2.0.0');
  });

  it('omits version when null', () => {
    const result = generateSkillMd({
      name: 'test',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).not.toContain('version');
  });

  it('includes author when provided', () => {
    const result = generateSkillMd({
      name: 'test',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
      author: 'octopus-team',
    });
    expect(result).toContain('author: octopus-team');
  });

  it('includes triggers list when provided', () => {
    const result = generateSkillMd({
      name: 'test',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
      triggers: ['代码审查', 'code review'],
    });
    expect(result).toContain('triggers:');
    expect(result).toContain('  - 代码审查');
    expect(result).toContain('  - code review');
  });

  it('omits author and triggers when not provided', () => {
    const result = generateSkillMd({
      name: 'test',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).not.toContain('author');
    expect(result).not.toContain('triggers');
  });
});

describe('mergeSkillMd', () => {
  it('preserves existing SKILL.md body, replaces frontmatter', () => {
    const existing = '---\nname: old\ndescription: old desc\n---\n\n# My Skill\n\nContent here.';
    const result = mergeSkillMd(existing, {
      name: 'new-name',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).toContain('name: new-name');
    expect(result).toContain('# My Skill');
    expect(result).toContain('Content here.');
    expect(result).not.toContain('name: old');
  });

  it('prepends frontmatter if no existing frontmatter', () => {
    const existing = '# My Skill\n\nNo frontmatter.';
    const result = mergeSkillMd(existing, {
      name: 'new-name',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).toContain('---\n');
    expect(result).toContain('name: new-name');
    expect(result).toContain('command-dispatch: tool');
    expect(result).toContain('# My Skill');
  });
});
