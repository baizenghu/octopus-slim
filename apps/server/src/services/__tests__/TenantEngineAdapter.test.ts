import { describe, it, expect, vi } from 'vitest';
import { TenantEngineAdapter } from '../TenantEngineAdapter';
import { EngineAdapter } from '../EngineAdapter';

// agentId / sessionKey 是纯字符串计算，不需要真实引擎实例
const mockEngine = {} as unknown as EngineAdapter;

describe('TenantEngineAdapter', () => {
  describe('agentId', () => {
    it('纯 ASCII userId + agentName 直接拼接', () => {
      const tb = new TenantEngineAdapter(mockEngine, 'alice', false);
      expect(tb.agentId('default')).toBe('ent_alice_default');
    });

    it('含非 ASCII 的 agentName 加 hash 后缀', () => {
      const tb = new TenantEngineAdapter(mockEngine, 'alice', false);
      const id = tb.agentId('助手');
      // 以 ent_alice_ 开头，后缀为 8 位 hex hash
      expect(id).toMatch(/^ent_alice_[0-9a-f]{8}$/);
    });

    it('结果与 EngineAdapter.userAgentId 完全一致', () => {
      const tb = new TenantEngineAdapter(mockEngine, 'bob', false);
      expect(tb.agentId('myagent')).toBe(EngineAdapter.userAgentId('bob', 'myagent'));
    });
  });

  describe('sessionKey', () => {
    it('结果与 EngineAdapter.userSessionKey 完全一致', () => {
      const tb = new TenantEngineAdapter(mockEngine, 'carol', false);
      const sid = 'abc123';
      expect(tb.sessionKey('default', sid))
        .toBe(EngineAdapter.userSessionKey('carol', 'default', sid));
    });

    it('格式为 agent:{agentId}:session:{sessionId}', () => {
      const tb = new TenantEngineAdapter(mockEngine, 'dave', false);
      const key = tb.sessionKey('default', 'sess1');
      expect(key).toBe('agent:ent_dave_default:session:sess1');
    });
  });

  describe('listMyAgents', () => {
    it('普通用户只看到自己的 agents', async () => {
      const agents = [
        { id: 'ent_alice_default' },
        { id: 'ent_bob_default' },
        { id: 'ent_alice_helper' },
      ];
      const engine = { agentsList: vi.fn().mockResolvedValue(agents) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', false);
      const result = await tb.listMyAgents();
      expect(result).toHaveLength(2);
      expect(result.every((a: any) => a.id.startsWith('ent_alice_'))).toBe(true);
    });

    it('admin 用户返回全量', async () => {
      const agents = [
        { id: 'ent_alice_default' },
        { id: 'ent_bob_default' },
      ];
      const engine = { agentsList: vi.fn().mockResolvedValue(agents) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', true);
      const result = await tb.listMyAgents();
      expect(result).toHaveLength(2);
    });
  });

  describe('listMyCrons', () => {
    it('普通用户只看到自己 agentId 的 cron', async () => {
      const result = {
        jobs: [
          { id: 'c1', agentId: 'ent_alice_default' },
          { id: 'c2', agentId: 'ent_bob_default' },
          { id: 'c3', agentId: 'ent_alice_helper' },
        ],
      };
      const engine = { cronList: vi.fn().mockResolvedValue(result) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', false);
      const out = await tb.listMyCrons() as any;
      expect(out.jobs).toHaveLength(2);
      expect(out.jobs.every((j: any) => j.agentId.startsWith('ent_alice_'))).toBe(true);
    });

    it('admin 用户返回全量', async () => {
      const result = { jobs: [{ id: 'c1', agentId: 'ent_alice_default' }, { id: 'c2', agentId: 'ent_bob_default' }] };
      const engine = { cronList: vi.fn().mockResolvedValue(result) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', true);
      const out = await tb.listMyCrons() as any;
      expect(out.jobs).toHaveLength(2);
    });
  });

  describe('listMySessions', () => {
    it('普通用户只看到自己的 sessions', async () => {
      const result = {
        sessions: [
          { key: 'agent:ent_alice_default:session:s1' },
          { key: 'agent:ent_bob_default:session:s2' },
          { key: 'agent:ent_alice_helper:session:s3' },
        ],
      };
      const engine = { sessionsList: vi.fn().mockResolvedValue(result) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', false);
      const out = await tb.listMySessions() as any;
      expect(out.sessions).toHaveLength(2);
    });

    it('admin 用户返回原始结构', async () => {
      const result = {
        sessions: [
          { key: 'agent:ent_alice_default:session:s1' },
          { key: 'agent:ent_bob_default:session:s2' },
        ],
      };
      const engine = { sessionsList: vi.fn().mockResolvedValue(result) } as unknown as EngineAdapter;
      const tb = new TenantEngineAdapter(engine, 'alice', true);
      const out = await tb.listMySessions() as any;
      expect(out.sessions).toHaveLength(2);
    });
  });
});
