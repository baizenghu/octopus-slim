import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tools-cache module before importing the tested module
vi.mock('../../utils/tools-cache', () => ({
  readToolsCache: vi.fn(),
}));

import { computeToolsFromAllowedSources } from '../AgentConfigSync';
import { readToolsCache } from '../../utils/tools-cache';

const mockReadToolsCache = vi.mocked(readToolsCache);

const mockMcpTools = [
  { serverId: 'mcp-gaode', serverName: 'mcp-gaode', toolName: 'search', nativeToolName: 'mcp__gaode__search', description: '' },
  { serverId: 'mcp-gaode', serverName: 'mcp-gaode', toolName: 'geocode', nativeToolName: 'mcp__gaode__geocode', description: '' },
  { serverId: 'mcp-sql',   serverName: 'mcp-sql',   toolName: 'query',  nativeToolName: 'mcp__sql__query',    description: '' },
];

beforeEach(() => {
  mockReadToolsCache.mockReturnValue(mockMcpTools);
});

// 注意：toolsFilter = null 语义为"禁用所有原生工具"（read/write/exec 组全部 deny）
// toolsFilter = ['read','write','exec'] 才是"不限制原生工具"

// 测试用辅助常量：放行全部原生工具
const ALL_NATIVE = ['read', 'write', 'exec'];

describe('computeToolsFromAllowedSources', () => {
  describe('allowedSources = null（不限制 MCP/Skill）', () => {
    it('null allowedSources 不 deny 任何 MCP 工具或 run_skill（放行全部原生工具时）', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).not.toContain('mcp__gaode__search');
      expect(deny).not.toContain('run_skill');
    });

    it('profile 始终为 coding', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      expect(result.profile).toBe('coding');
    });

    it('default agent 的 alsoAllow 包含 agents_list 和 group:plugins', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      expect(result.alsoAllow).toContain('agents_list');
      expect(result.alsoAllow).toContain('group:plugins');
    });

    it('null allowedSources + null toolsFilter → deny 全部原生工具（不 deny MCP/run_skill）', () => {
      const result = computeToolsFromAllowedSources(null, null, 'default');
      const deny = result.deny ?? [];
      // 原生工具全 deny（toolsFilter=null 语义）
      expect(deny).toContain('read');
      expect(deny).toContain('write');
      expect(deny).toContain('exec');
      // 不 deny MCP 工具和 run_skill
      expect(deny).not.toContain('mcp__gaode__search');
      expect(deny).not.toContain('run_skill');
    });
  });

  describe('allowedSources = []（全部禁止 MCP 和 Skill）', () => {
    it('空数组 deny 所有 MCP 工具和 run_skill', () => {
      const result = computeToolsFromAllowedSources([], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('mcp__gaode__search');
      expect(deny).toContain('mcp__gaode__geocode');
      expect(deny).toContain('mcp__sql__query');
      expect(deny).toContain('run_skill');
    });
  });

  describe('allowedSources = 指定 MCP 服务', () => {
    it('只允许 mcp-gaode 时，deny mcp__sql__query，不 deny mcp__gaode__*', () => {
      const result = computeToolsFromAllowedSources(['mcp-gaode'], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('mcp__sql__query');
      expect(deny).not.toContain('mcp__gaode__search');
      expect(deny).not.toContain('mcp__gaode__geocode');
    });

    it('只允许 mcp-gaode 时，仍然 deny run_skill（没有 skill 来源）', () => {
      const result = computeToolsFromAllowedSources(['mcp-gaode'], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('run_skill');
    });

    it('允许所有 MCP 服务时，deny 列表不包含任何 mcp 工具', () => {
      const result = computeToolsFromAllowedSources(['mcp-gaode', 'mcp-sql'], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).not.toContain('mcp__gaode__search');
      expect(deny).not.toContain('mcp__gaode__geocode');
      expect(deny).not.toContain('mcp__sql__query');
      // 仍无 skill 来源 → deny run_skill
      expect(deny).toContain('run_skill');
    });
  });

  describe('allowedSources 包含 skill 来源', () => {
    it('含非 MCP serverId 的来源视为 skill → 不 deny run_skill', () => {
      const result = computeToolsFromAllowedSources(['skill-report'], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).not.toContain('run_skill');
    });

    it('MCP + skill 混合白名单：只 deny 不在白名单的 MCP，不 deny run_skill', () => {
      const result = computeToolsFromAllowedSources(['mcp-gaode', 'skill-report'], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      // mcp-sql 不在白名单
      expect(deny).toContain('mcp__sql__query');
      // mcp-gaode 在白名单
      expect(deny).not.toContain('mcp__gaode__search');
      // 有 skill 来源，不 deny run_skill
      expect(deny).not.toContain('run_skill');
    });
  });

  describe('专业 agent（non-default）', () => {
    it('非 default agent 总是 deny subagents 相关工具', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'analyst');
      const deny = result.deny ?? [];
      expect(deny).toContain('subagents');
      expect(deny).toContain('sessions_spawn');
      expect(deny).toContain('agents_list');
    });

    it('default agent 不 deny subagents', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).not.toContain('subagents');
      expect(deny).not.toContain('sessions_spawn');
    });

    it('非 default agent 的 alsoAllow 不包含 agents_list', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'analyst');
      expect(result.alsoAllow).not.toContain('agents_list');
      expect(result.alsoAllow).toContain('group:plugins');
    });
  });

  describe('toolsFilter 原生工具控制', () => {
    it('不含 read → deny read/edit/apply_patch', () => {
      const result = computeToolsFromAllowedSources(null, ['write', 'exec'], 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('read');
      expect(deny).toContain('edit');
      expect(deny).toContain('apply_patch');
    });

    it('不含 write → deny write', () => {
      const result = computeToolsFromAllowedSources(null, ['read', 'exec'], 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('write');
      expect(deny).not.toContain('read');
    });

    it('不含 exec → deny exec/process', () => {
      const result = computeToolsFromAllowedSources(null, ['read', 'write'], 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('exec');
      expect(deny).toContain('process');
    });

    it('toolsFilter = ALL_NATIVE 时不 deny 原生工具', () => {
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).not.toContain('read');
      expect(deny).not.toContain('write');
      expect(deny).not.toContain('exec');
    });

    it('toolsFilter = null 时 deny 所有原生工具', () => {
      const result = computeToolsFromAllowedSources(null, null, 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('read');
      expect(deny).toContain('write');
      expect(deny).toContain('exec');
    });
  });

  describe('MCP 缓存为空时', () => {
    it('缓存为空时 allowedSources=[] 只 deny run_skill，不报错', () => {
      mockReadToolsCache.mockReturnValue([]);
      const result = computeToolsFromAllowedSources([], ALL_NATIVE, 'default');
      const deny = result.deny ?? [];
      expect(deny).toContain('run_skill');
      expect(deny).not.toContain('mcp__gaode__search');
    });

    it('缓存为空时 allowedSources=null + 全原生放行 → deny 为空', () => {
      mockReadToolsCache.mockReturnValue([]);
      const result = computeToolsFromAllowedSources(null, ALL_NATIVE, 'default');
      expect(result.deny ?? []).toEqual([]);
      expect(result.deny).toBeUndefined();
    });
  });
});
