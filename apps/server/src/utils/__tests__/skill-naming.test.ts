import { describe, it, expect } from 'vitest';
import { skillDirName, skillMdName, parseSkillMdName } from '../skill-naming';

describe('skillDirName', () => {
  it('enterprise skill: ent_{id}', () => {
    expect(skillDirName('enterprise', 'skill-123', null)).toBe('ent_skill-123');
  });
  it('personal skill: usr_{ownerId}_{id}', () => {
    expect(skillDirName('personal', 'skill-456', 'user-baizh')).toBe('usr_user-baizh_skill-456');
  });
  it('personal skill without ownerId falls back to ent_', () => {
    expect(skillDirName('personal', 'skill-789', null)).toBe('ent_skill-789');
  });
});

describe('skillMdName', () => {
  it('enterprise skill: 直接用 name', () => {
    expect(skillMdName('enterprise', '数据分析', null)).toBe('数据分析');
  });
  it('personal skill: name:ownerIdShort', () => {
    expect(skillMdName('personal', '数据分析', 'user-baizh')).toBe('数据分析:user-b');
  });
  it('personal skill: ownerId 短于 6 字符时用全称', () => {
    expect(skillMdName('personal', '工具', 'abc')).toBe('工具:abc');
  });
  it('personal skill without ownerId returns name as-is', () => {
    expect(skillMdName('personal', '工具', null)).toBe('工具');
  });
});

describe('parseSkillMdName', () => {
  it('plain name returns name only', () => {
    expect(parseSkillMdName('echarts-visualization')).toEqual({ name: 'echarts-visualization' });
  });
  it('scoped name returns name + ownerHint', () => {
    expect(parseSkillMdName('数据分析:user-b')).toEqual({ name: '数据分析', ownerHint: 'user-b' });
  });
  it('long suffix (>7 chars after colon) is not treated as owner hint', () => {
    expect(parseSkillMdName('tool:very-long-suffix')).toEqual({ name: 'tool:very-long-suffix' });
  });
});
