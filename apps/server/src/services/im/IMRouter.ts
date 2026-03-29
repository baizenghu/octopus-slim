/**
 * IM 消息路由
 *
 * 处理 IM 消息的核心逻辑：
 * - /bind 用户名 密码 → 绑定 IM 用户到企业账户
 * - /unbind → 解除绑定
 * - /status → 查看绑定状态
 * - 普通消息 → 路由到 callAgent
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IMAdapter, IMIncomingMessage } from './IMAdapter';
import { EngineAdapter } from '../EngineAdapter';
import { TenantEngineAdapter } from '../TenantEngineAdapter';
import type { AuthService } from '@octopus/auth';
import type { AppPrismaClient } from '../../types/prisma';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AuditLogger } from '@octopus/audit';
import { AuditAction } from '@octopus/audit';
import { randomUUID } from 'crypto';
import { stripReasoningTagsFromText } from '../../utils/reasoning-tags';
import { getRuntimeConfig } from '../../config';
import { createLogger } from '../../utils/logger';

const logger = createLogger('IMRouter');

// FILE_SIZE_LIMIT 现在通过 getRuntimeConfig().im.fileSizeLimitBytes 获取

// IM activeAgents 持久化文件路径（重启后恢复用户的 agent 选择）
const ACTIVE_AGENTS_FILE = path.join(
  process.env.OCTOPUS_STATE_DIR || '.octopus-state',
  'im-active-agents.json',
);

/** 从文件恢复 activeAgents Map */
function loadActiveAgents(): Map<string, string> {
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_AGENTS_FILE, 'utf8'));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

/** 持久化 activeAgents Map 到文件（fire-and-forget） */
function saveActiveAgents(map: Map<string, string>): void {
  try {
    fs.writeFileSync(ACTIVE_AGENTS_FILE, JSON.stringify(Object.fromEntries(map)));
  } catch (e: unknown) {
    logger.warn('[im-router] Failed to save activeAgents:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
  }
}

/** 清理模型输出中的 thinking/final 标签（兼容多种模型格式） */
function stripThinkTags(text: string): string {
  return stripReasoningTagsFromText(text, { mode: 'strict', trim: 'both' });
}

export class IMRouter {
  constructor(
    private prisma: AppPrismaClient,
    private bridge: EngineAdapter,
    private authService: AuthService,
    private ensureAgent: (userId: string, agentName: string) => Promise<void>,
    private dataRoot?: string,
    private workspaceManager?: WorkspaceManager,
    private auditLogger?: AuditLogger,
  ) {}

  /** IM 用户当前选中的 agent（启动时从文件恢复，变更时持久化） */
  private activeAgents = loadActiveAgents();

  /** /bind 频率限制：key = imUserId, value = { count, firstAttempt } */
  private bindAttempts = new Map<string, { count: number; firstAttempt: number }>();

  /** 活跃的 agent 调用跟踪（用于 /cancel 取消） */
  private activeRuns = new Map<string, { sessionKey: string; aborted: boolean }>();
  private static get RUN_TIMEOUT_MS() { return getRuntimeConfig().im.runTimeoutMs; }
  private static get BIND_MAX_ATTEMPTS() { return getRuntimeConfig().im.bindMaxAttempts; }
  private static get BIND_WINDOW_MS() { return getRuntimeConfig().im.bindWindowMs; }

  /** 注册 adapter 的消息回调 */
  attach(adapter: IMAdapter): void {
    adapter.onMessage((msg) => {
      this.handleMessage(adapter, msg).catch((e: unknown) => {
        logger.error(`[im-router] Error handling message from ${msg.channel}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      });
    });
  }

  /** 处理收到的 IM 消息 */
  private async handleMessage(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const { text, imUserId, channel } = msg;

    // 解析用户身份：微信多账号模式通过 imUserName 预绑定，飞书走 DB 查询
    let userId: string | null = null;
    if (channel === 'wechat' && msg.imUserName) {
      // 微信预绑定模式：imUserName 即 Octopus userId（扫码时已绑定）
      userId = msg.imUserName;
    }

    // 斜杠命令处理
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      switch (cmd) {
        case '/bind':
          // 微信预绑定用户不需要 /bind
          if (userId) {
            await adapter.sendText(imUserId, '你已通过扫码绑定，无需再次绑定。');
            return;
          }
          await this.handleBind(adapter, msg, parts);
          return;
        case '/unbind':
          await this.handleUnbind(adapter, msg);
          return;
        case '/status':
          await this.handleStatus(adapter, msg);
          return;
        case '/cancel':
          await this.handleCancel(adapter, msg);
          return;
      }
    }

    // 非微信预绑定用户：查 DB 绑定
    if (!userId) {
      const binding = await this.prisma.iMUserBinding.findUnique({
        where: {
          channel_imUserId: { channel, imUserId },
        },
      });
      userId = binding?.userId ?? null;
    }

    if (!userId) {
      await adapter.sendText(
        imUserId,
        '你还没有绑定企业账户。请发送：/bind 用户名 密码',
      );
      return;
    }

    // /agent 指令
    if (text === '/agent' || text.startsWith('/agent ')) {
      await this.handleAgentSwitch(adapter, msg, userId);
      return;
    }

    await this.routeToAgent(adapter, userId, msg);
  }

  /**
   * /bind 用户名 密码 → 认证并绑定
   *
   * 安全措施：验证后立即尝试删除含密码的原始消息，
   * 回复中不包含密码，日志中不记录密码。
   * TODO: 未来应迁移到 OAuth 或 Admin Console 验证码方案，彻底避免 IM 传输密码。
   */
  private async handleBind(
    adapter: IMAdapter,
    msg: IMIncomingMessage,
    parts: string[],
  ): Promise<void> {
    const { imUserId, channel } = msg;

    if (parts.length < 3) {
      await adapter.sendText(imUserId, '格式：/bind 用户名 密码');
      return;
    }

    // 频率限制：防止暴力破解
    const now = Date.now();
    const attempts = this.bindAttempts.get(imUserId);
    if (attempts) {
      if (now - attempts.firstAttempt < IMRouter.BIND_WINDOW_MS) {
        if (attempts.count >= IMRouter.BIND_MAX_ATTEMPTS) {
          await adapter.sendText(imUserId, '绑定尝试过于频繁，请 15 分钟后重试。');
          return;
        }
      } else {
        // 窗口过期，重置
        this.bindAttempts.delete(imUserId);
      }
    }

    const username = parts[1];
    const password = parts[2];

    // 安全：立即尝试删除含密码的原始消息
    this.tryDeleteMessage(adapter, msg.messageId);

    try {
      // 使用 authService.login 验证凭据
      await this.authService.login(username, password);

      // 查找用户 ID
      const user = await this.prisma.user.findFirst({
        where: { username },
        select: { userId: true, displayName: true },
      });
      if (!user) {
        await adapter.sendText(imUserId, '用户不存在');
        return;
      }

      // upsert 绑定关系
      await this.prisma.iMUserBinding.upsert({
        where: {
          channel_imUserId: { channel, imUserId },
        },
        create: {
          id: randomUUID(),
          channel,
          imUserId,
          userId: user.userId,
        },
        update: {
          userId: user.userId,
        },
      });

      // 绑定成功，清除频率限制记录
      this.bindAttempts.delete(imUserId);

      // 安全：回复中不包含密码
      await adapter.sendText(imUserId, `绑定成功！你好，${user.displayName || username}。现在可以直接发消息和 AI 对话了。`);
      // 审计记录
      this.auditLogger?.log({
        userId: user.userId,
        username,
        action: AuditAction.IM_BIND,
        resource: `im:${channel}:${imUserId}`,
        details: { channel, imUserId },
        success: true,
      }).catch(err => logger.warn('[im-router] 记录 IM 绑定审计日志失败', { error: (err as Error)?.message || String(err) }));
    } catch (e: unknown) {
      // 记录失败次数
      const prev = this.bindAttempts.get(imUserId);
      if (prev) {
        prev.count++;
      } else {
        this.bindAttempts.set(imUserId, { count: 1, firstAttempt: Date.now() });
      }
      // 安全：日志中不记录密码，仅记录用户名
      logger.error(`[im-router] Bind error for user=${username}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      // 审计记录
      this.auditLogger?.log({
        userId: null,
        username,
        action: AuditAction.IM_BIND_FAILED,
        resource: `im:${channel}:${imUserId}`,
        details: { channel, imUserId },
        success: false,
        errorMessage: e instanceof Error ? e.message : String(e),
      }).catch(err => logger.warn('[im-router] 记录 IM 绑定失败审计日志出错', { error: (err as Error)?.message || String(err) }));
      // 安全：错误回复不包含原始输入
      await adapter.sendText(imUserId, '绑定失败：用户名或密码错误');
    }
  }

  /**
   * 尝试删除含敏感信息的消息（fire-and-forget）
   * 删除失败不影响主流程（adapter 可能不支持或权限不足）
   */
  private tryDeleteMessage(adapter: IMAdapter, messageId: string): void {
    if (adapter.deleteMessage) {
      adapter.deleteMessage(messageId).catch((e: unknown) => {
        // 删除失败不阻塞（权限不足、消息已删等情况均可忽略）
        logger.warn(`[im-router] Failed to delete sensitive message ${messageId}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      });
    }
  }

  /** /unbind → 解除绑定 */
  private async handleUnbind(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const { imUserId, channel } = msg;

    try {
      // 先查询绑定信息（用于审计记录）
      const binding = await this.prisma.iMUserBinding.findUnique({
        where: { channel_imUserId: { channel, imUserId } },
      });
      if (!binding) {
        await adapter.sendText(imUserId, '你当前没有绑定企业账户。');
        return;
      }
      await this.prisma.iMUserBinding.delete({
        where: { channel_imUserId: { channel, imUserId } },
      });
      await adapter.sendText(imUserId, '已解除绑定。');
      // 审计记录
      this.auditLogger?.log({
        userId: binding.userId,
        username: 'im-user',
        action: AuditAction.IM_UNBIND,
        resource: `im:${channel}:${imUserId}`,
        details: { channel, imUserId },
        success: true,
      }).catch(err => logger.warn('[im-router] 记录 IM 解绑审计日志失败', { error: (err as Error)?.message || String(err) }));
    } catch {
      await adapter.sendText(imUserId, '解除绑定失败，请稍后重试。');
    }
  }

  /** /status → 查看绑定状态 */
  private async handleStatus(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const { imUserId, channel } = msg;

    const binding = await this.prisma.iMUserBinding.findUnique({
      where: {
        channel_imUserId: { channel, imUserId },
      },
    });

    if (binding) {
      const user = await this.prisma.user.findUnique({
        where: { userId: binding.userId },
        select: { username: true, displayName: true },
      });
      await adapter.sendText(imUserId, `已绑定账号: ${user?.displayName || user?.username || binding.userId}`);
    } else {
      await adapter.sendText(imUserId, '未绑定。请发送：/bind 用户名 密码');
    }
  }

  /** /cancel → 取消当前正在执行的 agent 调用 */
  private async handleCancel(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const imKey = `${msg.channel}:${msg.imUserId}`;
    const run = this.activeRuns.get(imKey);
    if (!run) {
      await adapter.sendText(msg.imUserId, '当前没有正在执行的任务。');
      return;
    }
    run.aborted = true;
    try {
      await this.bridge.call('chat.abort', { sessionKey: run.sessionKey });
    } catch (e: unknown) {
      logger.warn(`[im-router] chatAbort failed for ${run.sessionKey}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    }
    this.activeRuns.delete(imKey);
    await adapter.sendText(msg.imUserId, '已取消当前任务。');
  }

  /** /agent [名称] → 切换当前 IM 会话的 agent */
  private async handleAgentSwitch(
    adapter: IMAdapter,
    msg: IMIncomingMessage,
    userId: string,
  ): Promise<void> {
    const { imUserId, channel } = msg;
    const parts = msg.text.split(/\s+/);
    const imKey = `${channel}:${imUserId}`;

    // /agent（无参数）→ 显示当前 agent
    if (parts.length < 2) {
      const current = this.activeAgents.get(imKey) || 'default';
      await adapter.sendText(imUserId, `当前 Agent: ${current}`);
      return;
    }

    const targetName = parts[1];

    // /agent list → 列出所有可用 agent
    if (targetName === 'list') {
      const current = this.activeAgents.get(imKey) || 'default';
      const available = await this.prisma.agent.findMany({
        where: { ownerId: userId, enabled: true, isDefault: false },
        select: { name: true, description: true, identity: true },
      });
      const list = available.length > 0
        ? available.map((a: { name: string; description: string | null; identity: unknown }) => {
            const displayName = (a.identity as { name?: string } | null)?.name || a.name;
            const marker = a.name === current ? ' ← 当前' : '';
            const desc = a.description ? `：${a.description}` : '';
            return `- ${displayName}（${a.name}）${desc}${marker}`;
          }).join('\n')
        : '（无可用专业 Agent）';
      await adapter.sendText(imUserId, `可用 Agent：\n\n- 主助手（default）${current === 'default' ? ' ← 当前' : ''}\n${list}`);
      return;
    }

    // 切回 default 直接允许
    if (targetName === 'default') {
      this.activeAgents.delete(imKey);
      saveActiveAgents(this.activeAgents);
      await adapter.sendText(imUserId, '已切换到主助手 (default)');
      return;
    }

    // 查 DB 验证 agent 存在且属于该用户（userId 来自 binding，已验证存在性）
    try {
      const agent = await this.prisma.agent.findFirst({
        where: { ownerId: userId, name: targetName, enabled: true },
        select: { name: true, description: true, identity: true },
      });

      if (!agent) {
        // 列出可用 agent
        const available = await this.prisma.agent.findMany({
          where: { ownerId: userId, enabled: true, isDefault: false },
          select: { name: true, identity: true },
        });
        const list = available.length > 0
          ? available.map((a: any) => {
              const displayName = a.identity?.name || a.name;
              return `- ${displayName}（${a.name}）`;
            }).join('\n')
          : '（无可用专业 Agent）';
        await adapter.sendText(imUserId, `未找到 Agent "${targetName}"。\n\n可用 Agent：\n${list}\n\n使用 /agent default 切回主助手`);
        return;
      }

      // 确保 native agent 存在
      await this.ensureAgent(userId, targetName);

      // 更新 Map 并持久化
      this.activeAgents.set(imKey, targetName);
      saveActiveAgents(this.activeAgents);
      logger.info(`[im-router] agentSwitch: imKey=${imKey}, set to ${targetName}, map size=${this.activeAgents.size}`);

      // 审计记录
      this.auditLogger?.log({
        userId,
        username: 'im-user',
        action: AuditAction.IM_AGENT_SWITCH,
        resource: `agent:${targetName}`,
        details: { channel: msg.channel, imUserId: msg.imUserId, to: targetName },
        success: true,
      }).catch(err => logger.warn('[im-router] 记录 Agent 切换审计日志失败', { error: (err as Error)?.message || String(err) }));

      const displayName = (agent.identity as { name?: string } | null)?.name || agent.name;
      await adapter.sendText(imUserId, `已切换到 ${displayName}。使用 /agent default 切回主助手。`);
    } catch (e: unknown) {
      logger.error(`[im-router] Agent switch error:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      await adapter.sendText(imUserId, '切换 Agent 失败，请稍后重试。');
    }
  }

  /** 列出 outputs 目录下的文件名集合 */
  private async listOutputFiles(dir: string): Promise<Set<string>> {
    if (!dir) return new Set();
    try {
      const entries = await fs.promises.readdir(dir);
      return new Set(entries);
    } catch {
      return new Set();
    }
  }

  /** 发送新增的输出文件到 IM */
  private async sendNewOutputFiles(
    adapter: IMAdapter,
    imUserId: string,
    outputsDir: string,
    filesBefore: Set<string>,
  ): Promise<void> {
    try {
      const filesAfter = await this.listOutputFiles(outputsDir);
      const newFiles = [...filesAfter].filter(f => !filesBefore.has(f));
      if (newFiles.length === 0) return;

      for (const fileName of newFiles) {
        const filePath = path.join(outputsDir, fileName);
        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) continue;

          if (stat.size <= getRuntimeConfig().im.fileSizeLimitBytes) {
            // 发送文件，失败后重试 1 次
            try {
              await adapter.sendFile!(imUserId, filePath, fileName);
            } catch (firstErr) {
              logger.warn(`[im-router] sendFile first attempt failed for ${fileName}:`, { error: firstErr instanceof Error ? firstErr.message : String(firstErr), stack: firstErr instanceof Error ? firstErr.stack : undefined });
              await new Promise(r => setTimeout(r, 1000));
              await adapter.sendFile!(imUserId, filePath, fileName);
            }
            logger.info(`[im-router] Sent file via IM: ${fileName} (${(stat.size / 1024).toFixed(0)}KB)`);
          } else {
            const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
            await adapter.sendText(imUserId, `📎 文件 ${fileName} (${sizeMB}MB) 过大，请到 Web 端下载。`);
          }
        } catch (e: unknown) {
          logger.error(`[im-router] Failed to send file ${fileName}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
          await adapter.sendText(imUserId, `📎 文件 ${fileName} 发送失败，请到 Web 端下载。`);
        }
      }
    } catch (e: unknown) {
      logger.error('[im-router] sendNewOutputFiles error:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    }
  }

  /** 普通消息路由到 callAgent */
  private async routeToAgent(
    adapter: IMAdapter,
    userId: string,
    msg: IMIncomingMessage,
  ): Promise<void> {
    const imKey = `${msg.channel}:${msg.imUserId}`;
    const agentName = this.activeAgents.get(imKey) || 'default';
    logger.info(`[im-router] routeToAgent: imKey=${imKey}, agentName=${agentName}, activeAgents size=${this.activeAgents.size}`);
    const tenant = TenantEngineAdapter.forUser(this.bridge, userId);
    const agentId = tenant.agentId(agentName);
    const sessionId = `im-${msg.channel}-${msg.imUserId}`;
    const sessionKey = tenant.sessionKey(agentName, sessionId);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 非 default agent：验证 agent 仍然存在且启用，否则自动回落 default
      if (agentName !== 'default') {
        const agentExists = await this.prisma.agent.findFirst({
          where: { ownerId: userId, name: agentName, enabled: true },
          select: { name: true },
        });
        if (!agentExists) {
          this.activeAgents.delete(imKey);
          saveActiveAgents(this.activeAgents);
          await adapter.sendText(msg.imUserId, `Agent "${agentName}" 已不可用，已自动切回主助手。`);
          // 回落到 default，重新调用自身
          return this.routeToAgent(adapter, userId, msg);
        }
      }

      await this.ensureAgent(userId, agentName);

      // 记录 outputs 目录的文件快照（用于对比新增文件）
      const outputsDir = this.dataRoot
        ? (agentName === 'default'
            ? path.join(this.dataRoot, 'users', userId, 'workspace', 'outputs')
            : path.join(this.dataRoot, 'users', userId, 'agents', agentName, 'workspace', 'outputs'))
        : '';
      const filesBefore = await this.listOutputFiles(outputsDir);

      // 构建 IM 链路安全 system prompt（与 Web 聊天 chat.ts 对齐）
      let extraSystemPrompt: string | undefined;
      if (this.workspaceManager || this.dataRoot) {
        try {
          let workspacePath: string, filesPath: string, outputsPath: string, tempPath: string;
          if (this.workspaceManager) {
            workspacePath = this.workspaceManager.getAgentWorkspacePath(userId, agentName);
            filesPath = this.workspaceManager.getAgentSubPath(userId, agentName, 'FILES');
            outputsPath = this.workspaceManager.getAgentSubPath(userId, agentName, 'OUTPUTS');
            tempPath = this.workspaceManager.getAgentSubPath(userId, agentName, 'TEMP');
          } else if (this.dataRoot) {
            workspacePath = path.join(this.dataRoot, 'users', userId, 'agents', agentName, 'workspace');
            filesPath = path.join(this.dataRoot, 'users', userId, 'files');
            outputsPath = path.join(this.dataRoot, 'users', userId, 'outputs');
            tempPath = path.join(this.dataRoot, 'users', userId, 'temp');
          } else {
            throw new Error('no workspace info');
          }
          extraSystemPrompt =
            `## 工作区\n` +
            `工作空间根目录: ${workspacePath}\n` +
            `用户上传文件: ${filesPath}\n` +
            `用户可下载文件: ${outputsPath}\n` +
            `临时工作目录: ${tempPath}\n\n` +
            `**文件管理规范（必须遵守）：**\n` +
            `- files/：用户上传的文件，只读取不修改\n` +
            `- outputs/：需要交付给用户的最终成果文件（报告、文档等）。系统会在你回复后**自动**将 outputs/ 中的新文件发送给用户（包括当前 IM 渠道），无需你手动发送\n` +
            `- temp/：你的中间产物（脚本、临时数据、草稿等）必须写入此目录\n` +
            `- 严禁在工作空间根目录直接创建文件\n\n` +
            `**安全约束（必须遵守）：**\n` +
            `- 所有文件读写操作只能在 ${workspacePath} 目录内进行\n` +
            `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
            `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
            `- Shell 命令在沙箱容器内执行，可以使用 exec 工具运行命令`;
        } catch { /* ignore */ }
      }


      // 如果上一个调用还在进行，自动取消
      const prevRun = this.activeRuns.get(imKey);
      if (prevRun && !prevRun.aborted) {
        prevRun.aborted = true;
        this.bridge.call('chat.abort', { sessionKey: prevRun.sessionKey }).catch(err => logger.warn('[im-router] 取消前一个 agent 调用失败', { error: err?.message || String(err) }));
      }

      const runState = { sessionKey, aborted: false };
      this.activeRuns.set(imKey, runState);

      // 30 分钟兜底超时
      timeoutTimer = setTimeout(() => {
        if (!runState.aborted) {
          runState.aborted = true;
          this.bridge.call('chat.abort', { sessionKey }).catch(() => {});
          this.activeRuns.delete(imKey);
          adapter.sendText(msg.imUserId, '任务执行超时（30分钟），已自动取消。').catch(err => logger.warn('[im-router] 发送超时通知失败', { error: err?.message || String(err) }));
        }
      }, IMRouter.RUN_TIMEOUT_MS);

      // 调用 agent，等待 done 事件收集完整回复
      let finalContent = '';

      await new Promise<void>((resolve, reject) => {
        this.bridge.callAgent(
          {
            message: msg.text,
            agentId,
            sessionKey,
            deliver: false,
            extraSystemPrompt,
            isAdmin: false,
          },
          (event) => {
            if (runState.aborted) { resolve(); return; }
            if (event.type === 'text_delta') {
              finalContent = event.content || '';
            }
            if (event.type === 'done') resolve();
            if (event.type === 'error') reject(new Error(event.error || 'Agent error'));
          },
        ).catch(reject);
      });

      clearTimeout(timeoutTimer);
      this.activeRuns.delete(imKey);

      // 已取消的任务不发送回复
      if (runState.aborted) return;

      if (finalContent) {
        const cleaned = stripThinkTags(finalContent);
        if (cleaned) {
          await adapter.sendText(msg.imUserId, cleaned);
        }
      }

      // 检测并发送新增的输出文件
      if (outputsDir && adapter.sendFile) {
        await this.sendNewOutputFiles(adapter, msg.imUserId, outputsDir, filesBefore);
      }
    } catch (e: unknown) {
      clearTimeout(timeoutTimer);
      this.activeRuns.delete(imKey);
      logger.error(`[im-router] Agent call error for ${userId}:`, { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      await adapter.sendText(msg.imUserId, '处理消息时出错，请稍后重试。');
    }
  }
}
