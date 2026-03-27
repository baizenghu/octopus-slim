/**
 * PrismaAgentStore — 基于 MySQL (Prisma) 的 AgentStore 实现
 *
 * 将引擎 AgentStore 接口桥接到企业层 Prisma Agent 表。
 * Phase 5.1 在引擎层定义了 AgentStore 接口，此处为企业层实现。
 */

import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';

const logger = createLogger('PrismaAgentStore');

// ---- AgentStore 接口（内联定义，避免依赖引擎包） ----

export interface AgentStoreEntry {
  id: string;
  name?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  tools?: { profile?: string; allow?: string[]; alsoAllow?: string[]; deny?: string[] };
  skills?: string[];
  heartbeat?: { every: string; prompt: string };
  subagents?: { allowAgents?: string[] };
  memoryScope?: string[];
  sandbox?: { mode?: string };
  workspace?: string;
  [key: string]: unknown;
}

export interface AgentStore {
  list(filter?: { tenantId?: string }): Promise<AgentStoreEntry[]>;
  get(agentId: string): Promise<AgentStoreEntry | null>;
  create(entry: AgentStoreEntry): Promise<void>;
  update(agentId: string, patch: Partial<AgentStoreEntry>): Promise<void>;
  delete(agentId: string): Promise<void>;
}

// ---- Prisma Agent record type (fields we use) ----

interface AgentRecord {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  model: string | null;
  systemPrompt: string | null;
  identity: unknown;
  allowedToolSources: unknown;
  toolsProfile: string | null;
  toolsDeny: unknown;
  toolsAllow: unknown;
  subagents: unknown;
  memoryScope: unknown;
  sandboxMode: string | null;
  enabled: boolean;
  isDefault: boolean;
}

// ---- Implementation ----

export class PrismaAgentStore implements AgentStore {
  constructor(private prisma: PrismaClient) {}

  async list(filter?: { tenantId?: string }): Promise<AgentStoreEntry[]> {
    const agents = await this.prisma.agent.findMany({
      where: filter?.tenantId ? { ownerId: filter.tenantId } : {},
    });
    return agents.map((a) => this.toEntry(a as AgentRecord));
  }

  async get(agentId: string): Promise<AgentStoreEntry | null> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return null;
    return this.toEntry(agent as AgentRecord);
  }

  async create(entry: AgentStoreEntry): Promise<void> {
    const data = this.toDbRecord(entry);
    await this.prisma.agent.create({ data });
    logger.info(`Agent created: ${entry.id}`);
  }

  async update(agentId: string, patch: Partial<AgentStoreEntry>): Promise<void> {
    const data = this.toDbRecord({ id: agentId, ...patch });
    // id is the primary key — remove it from the update payload
    delete (data as Record<string, unknown>).id;
    await this.prisma.agent.update({ where: { id: agentId }, data });
    logger.info(`Agent updated: ${agentId}`);
  }

  async delete(agentId: string): Promise<void> {
    await this.prisma.agent.delete({ where: { id: agentId } });
    logger.info(`Agent deleted: ${agentId}`);
  }

  // ---- DB record → AgentStoreEntry ----

  private toEntry(record: AgentRecord): AgentStoreEntry {
    const entry: AgentStoreEntry = { id: record.id };

    if (record.name) entry.name = record.name;
    if (record.model) entry.model = record.model;
    if (record.systemPrompt) entry.systemPrompt = record.systemPrompt;

    // tenantId — 企业层额外字段，对应 ownerId
    entry.tenantId = record.ownerId;

    // tools — 从平铺字段组装为嵌套结构
    const tools: NonNullable<AgentStoreEntry['tools']> = {};
    let hasTools = false;
    if (record.toolsProfile) {
      tools.profile = record.toolsProfile;
      hasTools = true;
    }
    if (record.toolsAllow) {
      tools.allow = record.toolsAllow as string[];
      hasTools = true;
    }
    if (record.toolsDeny) {
      tools.deny = record.toolsDeny as string[];
      hasTools = true;
    }
    if (hasTools) entry.tools = tools;

    // subagents — DB 中为 Json，直接映射
    if (record.subagents) {
      entry.subagents = record.subagents as AgentStoreEntry['subagents'];
    }

    // memoryScope — DB 中为 Json (string[])
    if (record.memoryScope) {
      entry.memoryScope = record.memoryScope as string[];
    }

    // sandbox — 从 sandboxMode 字符串组装为嵌套结构
    if (record.sandboxMode) {
      entry.sandbox = { mode: record.sandboxMode };
    }

    // allowedToolSources — 企业层额外字段
    if (record.allowedToolSources) {
      entry.allowedToolSources = record.allowedToolSources as string[];
    }

    // identity — 企业层额外字段
    if (record.identity) {
      entry.identity = record.identity;
    }

    // description — 企业层额外字段
    if (record.description) {
      entry.description = record.description;
    }

    // enabled / isDefault — 企业层额外字段
    entry.enabled = record.enabled;
    entry.isDefault = record.isDefault;

    return entry;
  }

  // ---- AgentStoreEntry → DB record ----

  private toDbRecord(entry: Partial<AgentStoreEntry>): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    if (entry.id !== undefined) data.id = entry.id;
    if (entry.name !== undefined) data.name = entry.name;
    if (entry.model !== undefined) data.model = entry.model;
    if (entry.systemPrompt !== undefined) data.systemPrompt = entry.systemPrompt;

    // tenantId → ownerId
    if (entry.tenantId !== undefined) {
      data.ownerId = entry.tenantId;
    }

    // tools (嵌套) → 平铺字段
    if (entry.tools !== undefined) {
      if (entry.tools.profile !== undefined) data.toolsProfile = entry.tools.profile;
      if (entry.tools.allow !== undefined) data.toolsAllow = entry.tools.allow;
      if (entry.tools.deny !== undefined) data.toolsDeny = entry.tools.deny;
    }

    // subagents — 直接写入 Json 字段
    if (entry.subagents !== undefined) data.subagents = entry.subagents;

    // memoryScope — 直接写入 Json 字段
    if (entry.memoryScope !== undefined) data.memoryScope = entry.memoryScope;

    // sandbox (嵌套) → sandboxMode 字符串
    if (entry.sandbox !== undefined) {
      data.sandboxMode = entry.sandbox?.mode ?? null;
    }

    // 企业层额外字段
    if (entry.allowedToolSources !== undefined) {
      data.allowedToolSources = entry.allowedToolSources;
    }
    if (entry.identity !== undefined) data.identity = entry.identity;
    if (entry.description !== undefined) data.description = entry.description;
    if (entry.enabled !== undefined) data.enabled = entry.enabled;
    if (entry.isDefault !== undefined) data.isDefault = entry.isDefault;

    return data;
  }
}
