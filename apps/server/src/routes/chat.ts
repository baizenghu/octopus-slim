/**
 * 对话路由 — Native Bridge 版本
 *
 * POST /api/chat                              - 发送消息（非流式）
 * POST /api/chat/stream                       - 发送消息（SSE 流式）
 * GET  /api/chat/models                       - 获取可用模型列表
 * GET  /api/chat/sessions                     - 列出用户会话
 * PUT  /api/chat/sessions/:id/title           - 重命名会话
 * POST /api/chat/sessions/:id/generate-title  - 兼容占位（原生 agent 自动标注）
 * GET  /api/chat/search?q=keyword             - 搜索历史消息（暂不支持）
 * GET  /api/chat/history/:sessionId           - 获取完整会话历史
 * GET  /api/chat/export/:sessionId            - 导出会话（暂不支持）
 * DELETE /api/chat/history/:sessionId         - 清除会话
 *
 * 所有 AI 对话委托 Native Octopus Gateway（通过 EngineAdapter WebSocket RPC）
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { GatewayConfig } from '../config';
import { getRuntimeConfig } from '../config';
import { createAuthMiddleware, isAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { type AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AuditLogger } from '@octopus/audit';
import { EngineAdapter } from '../services/EngineAdapter';
import { ensureAndSyncNativeAgent } from '../services/AgentConfigSync';

import { validateSessionOwnership } from '../utils/ownership';
import { sanitizeResponse } from '../utils/ContentSanitizer';
import { stripReasoningTagsFromText } from '../utils/reasoning-tags';
import { autoGenerateTitle, loadAgentFromDb } from './sessions';
import { buildEnterpriseSystemPrompt } from '../services/SystemPromptBuilder';
import { checkDueReminders } from './scheduler';
import { createLogger } from '../utils/logger';

const logger = createLogger('chat');

/**
 * Session 级偏好存储（进程内一级缓存，重启后清空，TTL 可配置）。
 *
 * 已知限制：当前仅存储在内存 Map 中，进程重启后丢失。
 * 引擎的 sessions.patch schema 使用 additionalProperties: false，
 * 不支持存储任意 metadata（如 prefs）。若未来需要持久化，需先在
 * SessionsPatchParamsSchema 中添加 prefs 字段，或新增专门的
 * sessions.meta.patch RPC 方法。
 */
const sessionPrefs = new Map<string, { mcpId?: string; skillId?: string; updatedAt: number }>();

const activeStreams = new Map<string, number>(); // userId → 活跃 SSE 连接数
const MAX_CONCURRENT_STREAMS = 5;
const MAX_MESSAGE_LENGTH = 100_000; // 100K 字符
const MAX_STREAM_DURATION_MS = 30 * 60 * 1000; // 30 分钟

// 将 setInterval 返回值保存并调用 unref，不阻塞 graceful shutdown
const prefsCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionPrefs) {
    if (now - val.updatedAt > getRuntimeConfig().chat.sessionPrefsTTLMs) sessionPrefs.delete(key);
  }
  // 安全上限：防止内存无限增长
  while (sessionPrefs.size > 10000) {
    const oldest = sessionPrefs.keys().next().value;
    if (oldest) sessionPrefs.delete(oldest); else break;
  }
}, getRuntimeConfig().chat.sessionPrefsCleanupIntervalMs);
prefsCleanupTimer.unref();

export function createChatRouter(
  _config: GatewayConfig,
  authService: AuthService,
  workspaceManager: WorkspaceManager,
  bridge: EngineAdapter | undefined,
  prisma?: any,
  auditLogger?: AuditLogger,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma, bridge);

  /**
   * 斜杠命令处理器
   * 返回 null 表示不是斜杠命令
   * 返回 { reply } 表示纯斜杠命令，直接返回结果
   * 返回 { reply, passthrough } 表示设置偏好后，passthrough 作为正常消息继续处理
   */
  async function handleSlashCommand(
    message: string,
    _userId: string,
    sessionId: string,
    agent?: { mcpFilter?: string[] | null; skillsFilter?: string[] | null } | null,
  ): Promise<{ reply: string; passthrough?: string } | null> {
    if (!message.startsWith('/')) return null;

    const trimmed = message.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    switch (cmd) {
      case '/help':
        return { reply: [
          '**可用命令：**',
          '- `/help` — 显示此帮助信息',
          '- `/mcp <名称> [问题]` — 使用指定 MCP 工具（可直接附带问题）',
          '- `/skill <名称> [问题]` — 使用指定 Skill（可直接附带问题）',
        ].join('\n') };

      case '/mcp': {
        const mcpParts = arg.split(/\s+/);
        const mcpArg = mcpParts[0];
        if (!mcpArg) return { reply: '用法: `/mcp <名称> [问题]` — 请指定 MCP 工具' };
        // 按 id 或 name 查找
        const mcpServer = await prisma.toolSource.findFirst({
          where: { type: 'mcp', OR: [{ id: mcpArg }, { name: mcpArg }] },
        });
        const mcpId = mcpServer?.id || mcpArg;
        const mcpName = mcpServer?.name || mcpArg;
        // 校验 agent 的 mcpFilter 白名单（null/[] = 全部禁用，有值数组 = 白名单）
        const mcpAllow = agent?.mcpFilter as string[] | null | undefined;
        if (!Array.isArray(mcpAllow) || mcpAllow.length === 0 || (!mcpAllow.includes(mcpId) && !mcpAllow.includes(mcpName))) {
          return { reply: `当前 Agent 不允许使用 MCP 工具 \`${mcpName}\`` };
        }
        const prefs = sessionPrefs.get(sessionId) || { updatedAt: Date.now() };
        prefs.mcpId = mcpId;
        prefs.updatedAt = Date.now();
        sessionPrefs.set(sessionId, prefs);
        // 提取附带问题
        const mcpQuestion = mcpParts.slice(1).join(' ').trim();
        if (mcpQuestion) {
          return { reply: `使用 MCP: \`${mcpName}\``, passthrough: `[请使用 ${mcpName} MCP 工具完成以下任务]\n${mcpQuestion}` };
        }
        return { reply: `已设置本会话 MCP 偏好: \`${mcpName}\`，后续消息将优先使用该工具` };
      }

      case '/skill': {
        const skillParts = arg.split(/\s+/);
        const skillArg = skillParts[0];
        if (!skillArg) return { reply: '用法: `/skill <名称> [问题]` — 请指定 Skill 名称\n例如: `/skill ppt-generator 做一个PPT`' };
        // 按 id 或 name 查找（精确匹配）
        let skillRecord = await prisma.toolSource.findFirst({
          where: { type: 'skill', OR: [{ id: skillArg }, { name: skillArg }] },
        });
        // 未找到时尝试模糊匹配（用户可能没写完整名称）
        if (!skillRecord) {
          skillRecord = await prisma.toolSource.findFirst({
            where: { type: 'skill', OR: [
              { name: { contains: skillArg } },
              { id: { contains: skillArg } },
            ] },
          });
        }
        if (!skillRecord) {
          // 列出可用 Skill 帮助用户
          const available = await prisma.toolSource.findMany({ where: { type: 'skill', enabled: true }, select: { name: true } });
          const list = available.map((s: { name: string }) => `\`${s.name}\``).join(', ');
          return { reply: `未找到 Skill \`${skillArg}\`\n\n可用 Skill: ${list || '无'}\n\n用法: \`/skill <名称> [问题]\`` };
        }
        const skillId = skillRecord.id;
        const skillName = skillRecord.name;
        // 校验 agent 的 skillsFilter 白名单（null/[] = 全部禁用，有值数组 = 白名单）
        const skillAllow = agent?.skillsFilter as string[] | null | undefined;
        if (!Array.isArray(skillAllow) || skillAllow.length === 0 || (!skillAllow.includes(skillId) && !skillAllow.includes(skillName))) {
          return { reply: `当前 Agent 不允许使用 Skill \`${skillName}\`，请联系管理员授权` };
        }
        const prefs = sessionPrefs.get(sessionId) || { updatedAt: Date.now() };
        prefs.skillId = skillId;
        prefs.updatedAt = Date.now();
        sessionPrefs.set(sessionId, prefs);
        // 提取附带问题
        const skillQuestion = skillParts.slice(1).join(' ').trim();
        if (skillQuestion) {
          // 将 skill 指令注入消息，让 agent 明确知道要使用哪个 skill
          return { reply: `使用 Skill: \`${skillName}\``, passthrough: `[请严格按照 ${skillName} skill 的操作指南执行以下任务，必须使用技能自带的脚本，禁止自行编写替代代码]\n${skillQuestion}` };
        }
        return { reply: `已设置本会话 Skill 偏好: \`${skillName}\`，后续消息将优先使用该 Skill` };
      }

      case '/lesson': {
        // 系统内置技能：直接 passthrough 给 native agent 处理
        const lessonContent = arg || '请从当前对话中提取经验教训并存入记忆系统';
        return { reply: '正在存储经验教训...', passthrough: `/lesson ${lessonContent}` };
      }

      default:
        // 不认识的斜杠命令透传给原生 agent（支持 /new /reset /stop 等原生命令）
        return null;
    }
  }

  /** SOUL 模板：从 data/templates/ 文件加载，变量替换后返回 */
  const dataRoot = _config.workspace.dataRoot;


  /** 确保 native gateway 中存在对应 agent，不存在时自动创建；同时配置 memory scope 隔离 */
  async function ensureNativeAgent(userId: string, agentName: string) {
    if (!bridge?.isConnected) return;
    await ensureAndSyncNativeAgent(bridge, workspaceManager, userId, agentName, {
      useCache: true,
      dataRoot,
    });
  }

  /** 附件处理：保存到 agent workspace 并返回相对路径列表 */
  async function processAttachments(
    attachments: Array<{ name: string; content: string; type?: string }>,
    wsRoot: string,
  ): Promise<{ savedPaths: string[]; error?: string }> {
    // wsRoot 已经是 files 目录（getAgentSubPath 返回 .../workspace/files/）
    const filesDir = wsRoot;
    await fs.promises.mkdir(filesDir, { recursive: true });

    const savedPaths: string[] = [];
    for (const att of attachments) {
      if (!att.name || !att.content) continue;
      if (att.content.length > getRuntimeConfig().chat.maxAttachmentSizeBytes) {
        return { savedPaths: [], error: `附件 "${att.name}" 超过大小限制（最大 ${getRuntimeConfig().chat.maxAttachmentSizeBytes / 1024 / 1024}MB）` };
      }
      const safeName = att.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_');
      let targetPath = path.join(filesDir, safeName);
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(safeName);
        const base = path.basename(safeName, ext);
        targetPath = path.join(filesDir, `${base}_${Date.now()}${ext}`);
      }
      const isText = att.type?.startsWith('text/') || /\.(txt|md|csv|json|xml|yaml|yml|js|ts|py|sql|sh|log|html|css)$/i.test(att.name);
      if (isText) {
        await fs.promises.writeFile(targetPath, att.content, 'utf-8');
      } else {
        await fs.promises.writeFile(targetPath, Buffer.from(att.content, 'base64'));
      }
      savedPaths.push(path.relative(wsRoot, targetPath));
    }
    return { savedPaths };
  }

  // loadAgent 已提取为 sessions.ts 的 loadAgentFromDb

  /**
   * 流式对话（SSE）— 通过 Native Gateway agent RPC
   */
  router.post('/stream', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const { message, sessionId: rawSessionId, agentId: reqAgentId, attachments } = req.body;

    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (message && message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `消息长度不能超过 ${MAX_MESSAGE_LENGTH} 个字符` });
      return;
    }

    // 入口统一加载 Agent 配置（避免后续重复查询）
    const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
    const agentName = agent?.name || 'default';

    // 处理附件
    let finalMessage = message?.trim() || '';
    if (Array.isArray(attachments) && attachments.length > 0) {
      const filesDir = workspaceManager.getAgentSubPath(user.id, agentName, 'FILES');
      const { savedPaths, error } = await processAttachments(attachments, filesDir);
      if (error) { res.status(413).json({ error }); return; }
      if (savedPaths.length > 0) {
        const fileList = savedPaths.map(p => `- ${p}`).join('\n');
        finalMessage = `[用户上传了 ${savedPaths.length} 个文件，已保存到工作空间]\n${fileList}\n\n${finalMessage}`;
      }
    }

    // 斜杠命令拦截
    const sid0 = rawSessionId || 'tmp';
    const slashResult = await handleSlashCommand(message?.trim() || '', user.id, sid0, agent);
    if (slashResult !== null) {
      if (slashResult.passthrough) {
        // 有附带问题：先发偏好提示，再用剩余文本继续走正常对话流程
        // 保留附件前缀（如果有的话）
        const attachmentPrefix = finalMessage.match(/^(\[用户上传了 \d+ 个文件，已保存到工作空间\]\n(?:- .+\n?)+\n)/);
        finalMessage = attachmentPrefix ? attachmentPrefix[1] + slashResult.passthrough : slashResult.passthrough;
      } else {
        // 纯斜杠命令：直接返回结果
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ content: slashResult.reply, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ content: '', done: true, sessionId: sid0 })}\n\n`);
        res.end();
        return;
      }
    }

    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }

    const nativeAgentId = req.tenantBridge!.agentId(agentName);
    // 若前端传来的 sessionId 已经是完整 native session key（历史会话继续聊天），直接使用
    let sessionKey: string;
    let sid: string;
    if (rawSessionId && rawSessionId.startsWith('agent:')) {
      // 安全校验：确保 session key 属于当前用户
      if (!validateSessionOwnership(rawSessionId, user.id)) {
        res.status(403).json({ error: 'Access denied: session does not belong to current user' });
        return;
      }
      sessionKey = rawSessionId;
      sid = rawSessionId;
    } else {
      sid = rawSessionId || randomUUID().replace(/-/g, '').slice(0, 16);
      sessionKey = req.tenantBridge!.sessionKey(agentName, sid);
    }

    // 确保 native gateway 有此 agent（首次对话时自动创建）
    await ensureNativeAgent(user.id, agentName);

    // 审计日志
    try {
      await (auditLogger as any)?.log?.({ userId: user.id, action: 'chat', details: { agentId: nativeAgentId, sessionId: sid } });
    } catch (err) { logger.warn('审计日志记录失败', { error: (err as Error)?.message || String(err) }); }

    // 并发 SSE 流限制
    const currentStreams = activeStreams.get(user.id) || 0;
    if (currentStreams >= MAX_CONCURRENT_STREAMS) {
      res.status(429).json({ error: '并发对话数超限，请关闭其他对话后重试' });
      return;
    }

    // SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': sessionKey,
    });

    req.setTimeout(MAX_STREAM_DURATION_MS);
    res.setTimeout(MAX_STREAM_DURATION_MS);

    // 流式状态标记：客户端断连后停止写入
    let streamDone = false;

    // 心跳保活
    const heartbeat = setInterval(() => {
      try { if (!streamDone) res.write(': heartbeat\n\n'); } catch { /* closed */ }
    }, getRuntimeConfig().chat.sseHeartbeatIntervalMs);

    // 提醒推送：每 30s 检查到期提醒，通过 SSE 流推送给前端
    const reminderInterval = setInterval(async () => {
      if (streamDone) return;
      try {
        const reminders = await checkDueReminders(bridge, user.id);
        if (reminders.length > 0) {
          res.write(`data: ${JSON.stringify({ type: 'reminders', reminders })}\n\n`);
        }
      } catch { /* non-critical, skip silently */ }
    }, 30_000);

    res.on('close', () => {
      if (!streamDone) {
        streamDone = true;
        // 客户端断开连接，通知引擎终止生成
        bridge?.call('chat.abort', { sessionKey }).catch(() => {});
      }
      clearInterval(heartbeat);
      clearInterval(reminderInterval);
      // 递减活跃流计数
      const remaining = (activeStreams.get(user.id) || 1) - 1;
      if (remaining <= 0) activeStreams.delete(user.id);
      else activeStreams.set(user.id, remaining);
    });

    // P0 fix: 递增放在 close handler 注册之后，保证任何异常路径都能递减
    activeStreams.set(user.id, currentStreams + 1);

    // 构建企业级 extraSystemPrompt
    const extraPrompt = await buildEnterpriseSystemPrompt(user, agent, { prisma, workspaceManager, dataRoot });

    // 注入 session 级 skill/mcp 偏好到消息中（类似 CC 的 /skill 指令效果）
    const prefs = sessionPrefs.get(sid0);
    if (prefs && !finalMessage.startsWith('[请使用')) {
      if (prefs.skillId) {
        const skillRec = await prisma.toolSource.findFirst({ where: { type: 'skill', id: prefs.skillId } });
        if (skillRec) {
          finalMessage = `[请优先使用 ${skillRec.name} skill]\n${finalMessage}`;
        }
      } else if (prefs.mcpId) {
        const mcpRec = await prisma.toolSource.findFirst({ where: { type: 'mcp', id: prefs.mcpId } });
        if (mcpRec) {
          finalMessage = `[请优先使用 ${mcpRec.name} MCP 工具]\n${finalMessage}`;
        }
      }
    }

    // 调用原生 agent RPC（events 通过回调异步推送）
    let hasDelegation = false; // 是否有 sessions_spawn 委派调用
    // 思考模式：追踪已发送的 thinking / answer 文本，分离推送
    let prevThinkingSent = '';
    let prevAnswerSent = '';
    try {
      await bridge.callAgent(
        {
          message: finalMessage,
          agentId: nativeAgentId,
          sessionKey,
          extraSystemPrompt: extraPrompt,
          deliver: false,
          isAdmin: isAdmin(user),
        },
        (event) => {
          if (streamDone) return;
          switch (event.type) {
            case 'text_delta': {
              const fullText = event.content || '';

              // 用引擎的 stripReasoningTagsFromText 统一处理各种模型输出格式
              // 支持 <think>/<thinking>/<thought>/<antthinking> + <final> 标签
              // 保护代码块内的标签不被误删
              const thinkOpenMatch = fullText.match(/<\s*(?:think(?:ing)?|thought|antthinking)\b/i);
              if (!thinkOpenMatch) {
                // 普通模式：用引擎方式剥离可能的 <final> 等标签后推送增量
                const cleaned = stripReasoningTagsFromText(fullText, { mode: 'preserve', trim: 'start' });
                const delta = cleaned.startsWith(prevAnswerSent)
                  ? cleaned.slice(prevAnswerSent.length)
                  : cleaned;
                prevAnswerSent = cleaned;
                if (delta) {
                  res.write(`data: ${JSON.stringify({ content: delta, done: false })}\n\n`);
                }
              } else {
                // 思考模式：分离 thinking 和 answer
                const thinkOpenIdx = thinkOpenMatch.index!;
                const thinkTagEnd = fullText.indexOf('>', thinkOpenIdx);
                const thinkContentStart = thinkTagEnd !== -1 ? thinkTagEnd + 1 : thinkOpenIdx + thinkOpenMatch[0].length;
                const thinkCloseMatch = fullText.match(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\b[^>]*>/i);
                const thinkCloseIdx = thinkCloseMatch?.index ?? -1;

                const thinkContent = thinkCloseIdx !== -1
                  ? fullText.slice(thinkContentStart, thinkCloseIdx)
                  : fullText.slice(thinkContentStart);

                // 提取正文（</think> 之后，用引擎方式剥离 <final> 等标签）
                let answerContent = '';
                if (thinkCloseIdx !== -1) {
                  const closeTagEnd = thinkCloseIdx + thinkCloseMatch![0].length;
                  const afterThink = fullText.slice(closeTagEnd);
                  answerContent = stripReasoningTagsFromText(afterThink, { mode: 'preserve', trim: 'start' });
                }

                // 推送 thinking 增量
                const thinkDelta = thinkContent.startsWith(prevThinkingSent)
                  ? thinkContent.slice(prevThinkingSent.length)
                  : thinkContent;
                prevThinkingSent = thinkContent;
                if (thinkDelta) {
                  res.write(`data: ${JSON.stringify({ thinking: thinkDelta, done: false })}\n\n`);
                }

                // 推送 answer 增量
                const answerDelta = answerContent.startsWith(prevAnswerSent)
                  ? answerContent.slice(prevAnswerSent.length)
                  : answerContent;
                prevAnswerSent = answerContent;
                if (answerDelta) {
                  res.write(`data: ${JSON.stringify({ content: answerDelta, done: false })}\n\n`);
                }
              }
              break;
            }
            case 'tool_call':
              if (event.toolName?.includes('sessions_spawn')) {
                hasDelegation = true;
                logger.info(`[chat] sessions_spawn detected, hasDelegation=true`);
              }
              res.write(`data: ${JSON.stringify({ content: '', toolCall: true, tools: [event.toolName], toolCallId: event.toolCallId, toolArgs: event.toolArgs, toolResult: event.toolResult, done: false })}\n\n`);
              break;
            case 'thinking': {
              // 原生 thinking stream：直接推送思考内容增量
              const thinkText = event.content || '';
              if (thinkText) {
                const thinkDelta2 = thinkText.startsWith(prevThinkingSent)
                  ? thinkText.slice(prevThinkingSent.length)
                  : thinkText;
                prevThinkingSent = thinkText;
                if (thinkDelta2) {
                  res.write(`data: ${JSON.stringify({ thinking: thinkDelta2, done: false })}\n\n`);
                }
              }
              break;
            }
            case 'done': {
              streamDone = true;
              // 返回完整 sessionKey（而非短 sid），前端轮询和后续请求需要完整 key
              logger.info(`[chat] done event: hasDelegation=${hasDelegation}, sessionKey=${sessionKey}`);
              res.write(`data: ${JSON.stringify({ content: '', done: true, sessionId: sessionKey, ...(hasDelegation ? { delegated: true } : {}) })}\n\n`);
              clearInterval(heartbeat);
              clearInterval(reminderInterval);
              res.end();
              // 异步生成标题（不阻塞响应）
              autoGenerateTitle(bridge!, sessionKey).catch(err => logger.error('[TitleGen] Failed:', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }));
              break;
            }
            case 'error':
              streamDone = true;
              res.write(`data: ${JSON.stringify({ error: event.error, done: true })}\n\n`);
              clearInterval(heartbeat);
              clearInterval(reminderInterval);
              res.end();
              break;
          }
        },
      );
    } catch (err) {
      clearInterval(heartbeat);
      clearInterval(reminderInterval);
      if (!streamDone) {
        if (!res.headersSent) {
          next(err);
        } else {
          try {
            res.write(`data: ${JSON.stringify({ error: 'Internal server error', done: true })}\n\n`);
            res.end();
          } catch { /* closed */ }
        }
      }
    }
  });

  /**
   * 非流式对话
   */
  router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const { message, sessionId: rawSessionId, agentId: reqAgentId, attachments: attNonStream } = req.body;

    if (!message?.trim() && (!attNonStream || attNonStream.length === 0)) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `消息长度不能超过 ${MAX_MESSAGE_LENGTH} 个字符` });
      return;
    }

    // 入口统一加载 Agent 配置（避免后续重复查询）
    const agentNS = await loadAgentFromDb(prisma, user.id, reqAgentId);
    const agentNameNS = agentNS?.name || 'default';

    // 处理附件
    let finalMsgNonStream = message?.trim() || '';
    if (Array.isArray(attNonStream) && attNonStream.length > 0) {
      const filesDirNS = workspaceManager.getAgentSubPath(user.id, agentNameNS, 'FILES');
      const { savedPaths, error } = await processAttachments(attNonStream, filesDirNS);
      if (error) { res.status(413).json({ error }); return; }
      if (savedPaths.length > 0) {
        const fileList = savedPaths.map(p => `- ${p}`).join('\n');
        finalMsgNonStream = `[用户上传了 ${savedPaths.length} 个文件，已保存到工作空间]\n${fileList}\n\n${finalMsgNonStream}`;
      }
    }

    // 斜杠命令拦截
    const sid0 = rawSessionId || 'tmp';
    const slashResult = await handleSlashCommand(message?.trim() || '', user.id, sid0, agentNS);
    if (slashResult !== null) {
      if (slashResult.passthrough) {
        finalMsgNonStream = slashResult.passthrough;
      } else {
        res.json({ message: slashResult.reply, sessionId: sid0 });
        return;
      }
    }

    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }

    const nativeAgentId = req.tenantBridge!.agentId(agentNameNS);
    let sessionKey: string;
    let sid: string;
    if (rawSessionId && rawSessionId.startsWith('agent:')) {
      if (!validateSessionOwnership(rawSessionId, user.id)) {
        res.status(403).json({ error: 'Access denied: session does not belong to current user' });
        return;
      }
      sessionKey = rawSessionId;
      sid = rawSessionId;
    } else {
      sid = rawSessionId || randomUUID().replace(/-/g, '').slice(0, 16);
      sessionKey = req.tenantBridge!.sessionKey(agentNameNS, sid);
    }
    await ensureNativeAgent(user.id, agentNameNS);
    const extraPrompt = await buildEnterpriseSystemPrompt(user, agentNS, { prisma, workspaceManager, dataRoot });

    // 注入 session 级 skill/mcp 偏好
    const prefsNS = sessionPrefs.get(sid0);
    if (prefsNS && !finalMsgNonStream.startsWith('[请使用')) {
      if (prefsNS.skillId) {
        const sr = await prisma.toolSource.findFirst({ where: { type: 'skill', id: prefsNS.skillId } });
        if (sr) finalMsgNonStream = `[请优先使用 ${sr.name} skill]\n${finalMsgNonStream}`;
      } else if (prefsNS.mcpId) {
        const mr = await prisma.toolSource.findFirst({ where: { type: 'mcp', id: prefsNS.mcpId } });
        if (mr) finalMsgNonStream = `[请优先使用 ${mr.name} MCP 工具]\n${finalMsgNonStream}`;
      }
    }

    let fullContent = '';
    try {
      await new Promise<void>((resolve, reject) => {
        bridge!.callAgent(
          { message: finalMsgNonStream, agentId: nativeAgentId, sessionKey, extraSystemPrompt: extraPrompt, deliver: false, isAdmin: isAdmin(user) },
          (event) => {
            // native data.text 是累积全量文本（不是增量片段），直接替换
            if (event.type === 'text_delta') fullContent = event.content || fullContent;
            if (event.type === 'done') resolve();
            if (event.type === 'error') reject(new Error(event.error || 'Agent error'));
          },
        ).catch(reject);
      });

      // 响应净化
      const purified = sanitizeResponse(fullContent);

      // 异步尝试生成标题（不阻塞对话响应）
      autoGenerateTitle(bridge!, sessionKey).catch(err => logger.error('[TitleGen] Failed:', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }));

      res.json({ message: purified, sessionId: sessionKey });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
