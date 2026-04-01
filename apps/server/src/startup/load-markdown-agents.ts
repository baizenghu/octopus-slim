/**
 * load-markdown-agents.ts — 启动时加载 data/agents/ 目录的 Markdown Agent 定义
 *
 * 将 Markdown 文件解析结果通过 Prisma upsert 注册为企业级 Agent。
 *
 * ─── 三层来源优先级（高→低）──────────────────────────────────────────────────
 * 1. DB 中已有的 Agent（手动创建，优先级最高）
 *    identity._source 不为 'markdown'，表示由用户或管理员手动创建，跳过不覆盖
 * 2. data/agents/ 目录的 Markdown 定义（自动加载，可被 DB 覆盖）
 *    写入 DB 时标记 identity._source = 'markdown'，后续可被上层覆盖
 * 3. 引擎内建 Agent（不在此文件处理）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 约定：
 * - Markdown Agent 使用 ownerId = '_system' 表示企业公共 Agent
 * - Agent ID 格式：md_{agentName}（避免与用户 Agent 的 ent_ 前缀冲突）
 * - 若 DB 中已存在同名 Agent（任意 ownerId）且 identity._source != 'markdown'，跳过
 */

import * as path from 'path';
import * as fsSync from 'fs';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';

// AgentMarkdownDef 类型定义（与 load-agents-dir.ts 保持同步，避免 rootDir 限制）
export interface AgentMarkdownDef {
  /** Agent 唯一名称 */
  name: string;
  /** Agent 描述（可选） */
  description?: string;
  /** 使用的模型名称（可选） */
  model?: string;
  /** 允许使用的工具列表（可选） */
  allowedTools?: string[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 来源文件绝对路径 */
  sourcePath: string;
}

const logger = createLogger('MarkdownAgentLoader');

/** 标识 markdown 来源的 ownerId（企业公共 Agent） */
const MARKDOWN_OWNER_ID = '_system';

/** identity 中用于标记来源的字段 */
const SOURCE_MARKER_KEY = '_source';
const SOURCE_MARKER_VALUE = 'markdown';

/**
 * 将 AgentMarkdownDef 映射为 Prisma Agent 的 DB ID。
 * 格式：md_{agentName}，避免与用户 Agent 的 ent_ 前缀冲突。
 */
function toAgentDbId(name: string): string {
  return `md_${name}`;
}

/**
 * 检查 DB 中的 identity JSON 是否标记为 markdown 来源。
 *
 * @param identity DB 中的 identity 字段值（可能为 null / object）
 * @returns true 表示该 Agent 由 markdown 加载（可覆盖），false 表示手动创建（跳过）
 */
function isMarkdownSourced(identity: unknown): boolean {
  if (identity === null || typeof identity !== 'object') return false;
  const id = identity as Record<string, unknown>;
  return id[SOURCE_MARKER_KEY] === SOURCE_MARKER_VALUE;
}

/**
 * 将 Markdown Agent 定义列表 upsert 到 Prisma Agent 表。
 *
 * 优先级规则：若 DB 中已存在同名 Agent 且不是 markdown 来源，跳过（手动配置优先）。
 *
 * @param prisma     Prisma Client 实例
 * @param defs       解析完成的 AgentMarkdownDef 数组
 * @returns          { upserted: number; skipped: number; failed: number }
 */
async function upsertMarkdownAgents(
  prisma: PrismaClient,
  defs: AgentMarkdownDef[],
): Promise<{ upserted: number; skipped: number; failed: number }> {
  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of defs) {
    try {
      const agentId = toAgentDbId(def.name);

      // 查询 DB 中是否已存在同名 Agent（任意 ownerId）
      const existing = await prisma.agent.findFirst({
        where: { name: def.name },
        select: { id: true, ownerId: true, identity: true },
      });

      if (existing) {
        // 已存在且非 markdown 来源 → 跳过（手动配置优先级更高）
        if (!isMarkdownSourced(existing.identity)) {
          logger.info(
            `Skipping agent '${def.name}': already exists in DB with non-markdown source (id=${existing.id})`,
          );
          skipped++;
          continue;
        }
        // 已存在且是 markdown 来源 → 允许更新（重新加载 Markdown 文件）
        logger.info(`Updating markdown agent '${def.name}' from: ${def.sourcePath}`);
      } else {
        logger.info(`Registering new markdown agent '${def.name}' from: ${def.sourcePath}`);
      }

      // upsert：按 id 唯一键
      await prisma.agent.upsert({
        where: { id: agentId },
        update: {
          name: def.name,
          description: def.description ?? null,
          model: def.model ?? null,
          systemPrompt: def.systemPrompt,
          identity: {
            [SOURCE_MARKER_KEY]: SOURCE_MARKER_VALUE,
            sourcePath: def.sourcePath,
          },
          // 允许的工具列表存入 toolsAllow（原生工具白名单）
          toolsAllow: def.allowedTools ?? [],
          toolsProfile: 'coding',
          enabled: true,
          updatedAt: new Date(),
        },
        create: {
          id: agentId,
          name: def.name,
          description: def.description ?? null,
          ownerId: MARKDOWN_OWNER_ID,
          model: def.model ?? null,
          systemPrompt: def.systemPrompt,
          identity: {
            [SOURCE_MARKER_KEY]: SOURCE_MARKER_VALUE,
            sourcePath: def.sourcePath,
          },
          toolsAllow: def.allowedTools ?? [],
          toolsProfile: 'coding',
          toolsDeny: [],
          enabled: true,
          isDefault: false,
        },
      });

      upserted++;
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to upsert markdown agent '${def.name}'`, { error: msg });
    }
  }

  return { upserted, skipped, failed };
}

/**
 * 从指定目录加载所有 Markdown Agent 定义并注册到数据库。
 *
 * 此函数在服务启动时（数据库初始化完成后）调用一次；也可由热加载或 admin 接口触发。
 *
 * @param prisma     Prisma Client 实例
 * @param agentsDir  data/agents/ 目录的绝对路径
 * @returns          成功 upsert 的 agent 数量
 */
export async function loadAndRegisterMarkdownAgents(
  prisma: PrismaClient,
  agentsDir: string,
): Promise<number> {
  logger.info(`Loading markdown agents from: ${agentsDir}`);

  let defs: AgentMarkdownDef[];
  try {
    // Dynamic import avoids rootDir constraint (same pattern as init-services.ts engine imports)
    const { loadAgentsFromDir } = await import(
      '../../../../packages/engine/src/agents/pi-extensions/agent-orchestration/load-agents-dir.js'
    ) as { loadAgentsFromDir: (dir: string) => Promise<AgentMarkdownDef[]> };
    defs = await loadAgentsFromDir(agentsDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('loadAgentsFromDir threw unexpectedly', { error: msg });
    return 0;
  }

  if (defs.length === 0) {
    logger.info('No markdown agents to register');
    return 0;
  }

  const { upserted, skipped, failed } = await upsertMarkdownAgents(prisma, defs);

  logger.info(
    `Markdown agent loading complete: ${upserted} upserted, ${skipped} skipped (manual), ${failed} failed`,
    { agentsDir, total: defs.length },
  );

  return upserted;
}

/**
 * 使用 fs.watch 监听 agentsDir 目录变更，变更时防抖重新加载所有 Markdown Agent。
 *
 * @param prisma     Prisma Client 实例
 * @param agentsDir  data/agents/ 目录的绝对路径
 * @returns          停止监听的清理函数
 */
export function watchAgentsDir(prisma: PrismaClient, agentsDir: string): () => void {
  const DEBOUNCE_MS = 800;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // 目录不存在时跳过 watch，避免 ENOENT
  if (!fsSync.existsSync(agentsDir)) {
    logger.warn(`watchAgentsDir: directory not found, skipping watch: ${agentsDir}`);
    return () => { /* noop */ };
  }

  logger.info(`watchAgentsDir: watching ${agentsDir}`);

  const watcher = fsSync.watch(agentsDir, { recursive: false }, (_event, filename) => {
    if (filename && !filename.endsWith('.md')) return;

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      logger.info(`watchAgentsDir: change detected (${filename ?? 'unknown'}), reloading agents`);
      loadAndRegisterMarkdownAgents(prisma, agentsDir).catch((err: unknown) => {
        logger.error('watchAgentsDir: reload failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, DEBOUNCE_MS);
  });

  watcher.on('error', (err: Error) => {
    logger.error(`watchAgentsDir: watcher error`, { error: err.message });
  });

  return () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    watcher.close();
    logger.info('watchAgentsDir: watcher closed');
  };
}

/**
 * 计算 data/agents/ 目录的绝对路径。
 *
 * 约定：相对于项目根目录（dataRoot 的上两级，或通过 AGENTS_DIR 环境变量覆盖）。
 *
 * @param dataRoot  config.workspace.dataRoot（如 /path/to/data）
 * @returns         data/agents/ 的绝对路径
 */
export function resolveAgentsDir(dataRoot: string): string {
  if (process.env['AGENTS_DIR']) {
    return process.env['AGENTS_DIR'];
  }
  // dataRoot 通常是 /path/to/project/data，agents 子目录在同级
  return path.join(dataRoot, 'agents');
}
