/**
 * PrismaAgentStore — 基于 MySQL (Prisma) 的 AgentStore 实现
 *
 * 将引擎 AgentStore 接口桥接到企业层 Prisma Agent 表。
 * Phase 5.1 在引擎层定义了 AgentStore 接口，此处为企业层实现。
 *
 * 类型来源: @octopus/engine/plugin-sdk (packages/engine/src/agents/store.ts)
 */

import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import type { AgentStore, AgentStoreEntry } from '@octopus/engine/plugin-sdk';
import { createLogger } from '../utils/logger';

const logger = createLogger('PrismaAgentStore');

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
  skillsFilter: unknown;
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
  constructor(private prisma: PrismaClient, private dataRoot?: string) {}

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
    try {
      // 检查是否已存在（企业层先创建的）— 如果已存在则跳过
      const existing = await this.prisma.agent.findUnique({ where: { id: entry.id } });
      if (existing) {
        logger.info(`Agent already exists in DB, skipping create: ${entry.id}`);
        return;
      }

      const data = this.toDbRecord(entry);
      // 确保必需字段 — 引擎 agents.create 只传 id/name/workspace，
      // 需要从 agentId 提取 ownerId（格式：ent_{userId}_{agentName}）
      if (!data.ownerId && entry.id) {
        const match = entry.id.match(/^ent_(user-[^_]+)_/);
        if (match) data.ownerId = match[1];
        else data.ownerId = 'system';
      }
      if (!data.name) data.name = entry.name ?? entry.id;

      await this.prisma.agent.create({ data });
      logger.info(`Agent created: ${entry.id}`);
    } catch (err) {
      logger.error(`Failed to create agent ${entry.id}: ${err}`);
      throw new Error(`PrismaAgentStore.create failed for agent ${entry.id}`, { cause: err });
    }
  }

  async update(agentId: string, patch: Partial<AgentStoreEntry>): Promise<void> {
    try {
      // 使用 hasOwnProperty 过滤：只写入 patch 中显式提供的字段，
      // 避免 spread 后 undefined 值覆盖已有数据
      const fullRecord = this.toDbRecord(patch);
      const data: Record<string, unknown> = {};
      for (const key of Object.keys(fullRecord)) {
        if (Object.prototype.hasOwnProperty.call(fullRecord, key)) {
          data[key] = fullRecord[key];
        }
      }
      // id is the primary key — remove it from the update payload
      delete data.id;
      await this.prisma.agent.update({ where: { id: agentId }, data });
      logger.info(`Agent updated: ${agentId}`);
    } catch (err) {
      logger.error(`Failed to update agent ${agentId}: ${err}`);
      throw new Error(`PrismaAgentStore.update failed for agent ${agentId}`, { cause: err });
    }
  }

  async delete(agentId: string): Promise<void> {
    try {
      await this.prisma.agent.delete({ where: { id: agentId } });
      logger.info(`Agent deleted: ${agentId}`);
    } catch (err) {
      logger.error(`Failed to delete agent ${agentId}: ${err}`);
      throw new Error(`PrismaAgentStore.delete failed for agent ${agentId}`, { cause: err });
    }
  }

  // ---- DB record → AgentStoreEntry ----

  private toEntry(record: AgentRecord): AgentStoreEntry {
    const entry: AgentStoreEntry = { id: record.id };

    if (record.name) entry.name = record.name;
    if (record.model) entry.model = record.model;
    if (record.systemPrompt) entry.systemPrompt = record.systemPrompt;

    // tenantId — 企业层额外字段，对应 ownerId
    entry.tenantId = record.ownerId;

    // workspace — 统一到 data/users/{userId}/agents/{name}/workspace/
    if (this.dataRoot && record.ownerId && record.name) {
      const wsPath = path.join(this.dataRoot, 'users', record.ownerId, 'agents', record.name, 'workspace');
      if (!fs.existsSync(wsPath)) {
        try { fs.mkdirSync(wsPath, { recursive: true, mode: 0o777 }); } catch { /* ignore */ }
      }
      entry.workspace = wsPath;
    }

    // tools — 从平铺字段组装为嵌套结构
    const tools: NonNullable<AgentStoreEntry['tools']> = {};
    let hasTools = false;
    if (record.toolsProfile) {
      tools.profile = record.toolsProfile;
      hasTools = true;
    }
    if (record.toolsAllow) {
      tools.alsoAllow = record.toolsAllow as string[];
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

    // skills — DB skillsFilter 映射到引擎的 per-agent skills 白名单
    // undefined = 引擎默认（显示所有），[] = 不显示任何 skill
    if (record.skillsFilter !== undefined && record.skillsFilter !== null) {
      entry.skills = record.skillsFilter as string[];
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

    // enabled — 企业层额外字段
    entry.enabled = record.enabled;

    // default — 引擎 AgentConfig 使用 'default' 字段名，DB 使用 'isDefault'
    if (record.isDefault) {
      entry.default = record.isDefault;
    }

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
    // 当 tools 被传入时，将未出现的子字段显式设为 null，避免 partial update 遗留旧值
    if (entry.tools !== undefined) {
      data.toolsProfile = entry.tools.profile ?? null;
      data.toolsAllow = entry.tools.alsoAllow ?? entry.tools.allow ?? null;  // 优先 alsoAllow
      data.toolsDeny = entry.tools.deny ?? null;
    }

    // subagents — 直接写入 Json 字段
    if (entry.subagents !== undefined) data.subagents = entry.subagents;

    // memoryScope — 直接写入 Json 字段
    if (entry.memoryScope !== undefined) data.memoryScope = entry.memoryScope;

    // sandbox (嵌套) → sandboxMode 字符串
    if (entry.sandbox !== undefined) {
      data.sandboxMode = entry.sandbox?.mode ?? null;
    }

    // skills → skillsFilter (引擎 per-agent 白名单 → DB 字段)
    if (entry.skills !== undefined) {
      data.skillsFilter = entry.skills;
    }

    // 企业层额外字段
    if (entry.allowedToolSources !== undefined) {
      data.allowedToolSources = entry.allowedToolSources;
    }
    if (entry.identity !== undefined) data.identity = entry.identity;
    if (entry.description !== undefined) data.description = entry.description;
    if (entry.enabled !== undefined) data.enabled = entry.enabled;
    if (entry.default !== undefined) data.isDefault = entry.default;

    return data;
  }
}
