/**
 * TenantEngineAdapter — 按 userId 自动做 tenant 隔离的 EngineAdapter 封装
 *
 * 路由层通过 req.tenantBridge 访问，无需手动拼接 ent_{userId}_ 前缀。
 * admin=true 时跳过过滤，返回全量数据。
 */

import { EngineAdapter } from './EngineAdapter';

export class TenantEngineAdapter {
  readonly engine: EngineAdapter;
  readonly userId: string;
  readonly admin: boolean;

  constructor(engine: EngineAdapter, userId: string, admin = false) {
    this.engine = engine;
    this.userId = userId;
    this.admin = admin;
  }

  /** 计算当前用户某 agent 的原生 agentId */
  agentId(agentName: string): string {
    return EngineAdapter.userAgentId(this.userId, agentName);
  }

  /** 计算当前用户某 agent 的原生 sessionKey */
  sessionKey(agentName: string, sessionId: string): string {
    return EngineAdapter.userSessionKey(this.userId, agentName, sessionId);
  }

  /** 列出当前用户的 agents（admin 不过滤） */
  async listMyAgents(): Promise<any[]> {
    const result = await this.engine.agentsList() as any;
    const agents: any[] = result?.agents || result || [];
    if (this.admin) return agents;
    const prefix = `ent_${this.userId}_`;
    return agents.filter((a: any) => (a.id || a.agentId || '').startsWith(prefix));
  }

  /** 列出当前用户的 sessions（admin 不过滤），可按原生 agentId 精确查询 */
  async listMySessions(agentId?: string): Promise<any> {
    const result = await this.engine.sessionsList(agentId) as any;
    if (this.admin) return result;
    const sessions: any[] = result?.sessions || result || [];
    const prefix = `agent:ent_${this.userId}_`;
    const filtered = sessions.filter((s: any) => (s.key || s.sessionKey || '').startsWith(prefix));
    // 保持与原始返回结构兼容
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return { ...result, sessions: filtered };
    }
    return filtered;
  }

  /** 列出当前用户的 cron 任务（admin 不过滤） */
  async listMyCrons(includeDisabled = false): Promise<any> {
    const result = await this.engine.cronList(includeDisabled) as any;
    if (this.admin) return result;
    const jobs: any[] = result?.jobs || [];
    const prefix = `ent_${this.userId}_`;
    const filtered = jobs.filter((j: any) => (j.agentId || j.agent || '').startsWith(prefix));
    return { ...result, jobs: filtered };
  }
}
