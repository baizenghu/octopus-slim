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
import type { AuthService } from '@octopus/auth';
import type { AppPrismaClient } from '../../types/prisma';
import type { WorkspaceManager } from '@octopus/workspace';
import { randomUUID } from 'crypto';

const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB

/** 清理模型输出中的 <think> 标签 */
function stripThinkTags(text: string): string {
  const thinkOpen = text.indexOf('<think>');
  if (thinkOpen === -1) return text;
  const thinkClose = text.indexOf('</think>');
  if (thinkClose === -1) return '';
  return text.slice(thinkClose + 8).replace(/<\/?final>/g, '').trim();
}

export class IMRouter {
  constructor(
    private prisma: AppPrismaClient,
    private bridge: EngineAdapter,
    private authService: AuthService,
    private ensureAgent: (userId: string, agentName: string) => Promise<void>,
    private dataRoot?: string,
    private workspaceManager?: WorkspaceManager,
  ) {}

  /** IM 用户当前选中的 agent（进程级，重启回落 default） */
  private activeAgents = new Map<string, string>();

  /** 注册 adapter 的消息回调 */
  attach(adapter: IMAdapter): void {
    adapter.onMessage((msg) => {
      this.handleMessage(adapter, msg).catch((e: any) => {
        console.error(`[im-router] Error handling message from ${msg.channel}:`, e.message);
      });
    });
  }

  /** 处理收到的 IM 消息 */
  private async handleMessage(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const { text, imUserId, channel } = msg;
    // 斜杠命令处理
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      switch (cmd) {
        case '/bind':
          await this.handleBind(adapter, msg, parts);
          return;
        case '/unbind':
          await this.handleUnbind(adapter, msg);
          return;
        case '/status':
          await this.handleStatus(adapter, msg);
          return;
      }
    }

    // 普通消息 → 查绑定 → 路由到 agent
    // 普通消息 → 查绑定 → 路由到 agent
    const binding = await this.prisma.iMUserBinding.findUnique({
      where: {
        channel_imUserId: { channel, imUserId },
      },
    });

    if (!binding) {
      await adapter.sendText(
        imUserId,
        '你还没有绑定企业账户。请发送：/bind 用户名 密码',
      );
      return;
    }

    // /agent 指令：需要 userId，放在 binding 查询之后
    if (text.startsWith('/agent')) {
      await this.handleAgentSwitch(adapter, msg, binding.userId);
      return;
    }

    await this.routeToAgent(adapter, binding.userId, msg);
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

      // 安全：回复中不包含密码
      await adapter.sendText(imUserId, `绑定成功！你好，${user.displayName || username}。现在可以直接发消息和 AI 对话了。`);
    } catch (e: any) {
      // 安全：日志中不记录密码，仅记录用户名
      console.error(`[im-router] Bind error for user=${username}:`, e.message);
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
      adapter.deleteMessage(messageId).catch((e: any) => {
        // 删除失败不阻塞（权限不足、消息已删等情况均可忽略）
        console.warn(`[im-router] Failed to delete sensitive message ${messageId}:`, e.message);
      });
    }
  }

  /** /unbind → 解除绑定 */
  private async handleUnbind(adapter: IMAdapter, msg: IMIncomingMessage): Promise<void> {
    const { imUserId, channel } = msg;

    try {
      await this.prisma.iMUserBinding.delete({
        where: {
          channel_imUserId: { channel, imUserId },
        },
      });
      await adapter.sendText(imUserId, '已解除绑定。');
    } catch {
      await adapter.sendText(imUserId, '你当前没有绑定企业账户。');
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

    // 切回 default 直接允许
    if (targetName === 'default') {
      this.activeAgents.delete(imKey);
      await adapter.sendText(imUserId, '已切换到主助手 (default)');
      return;
    }

    // 查 DB 验证 agent 存在且属于该用户
    try {
      const user = await this.prisma.user.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (!user) {
        await adapter.sendText(imUserId, '用户信息异常，请重新绑定。');
        return;
      }

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

      // 更新 Map
      this.activeAgents.set(imKey, targetName);

      const displayName = (agent.identity as any)?.name || agent.name;
      await adapter.sendText(imUserId, `已切换到 ${displayName}。使用 /agent default 切回主助手。`);
    } catch (e: any) {
      console.error(`[im-router] Agent switch error:`, e.message);
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

          if (stat.size <= FILE_SIZE_LIMIT) {
            await adapter.sendFile!(imUserId, filePath, fileName);
            console.log(`[im-router] Sent file via IM: ${fileName} (${(stat.size / 1024).toFixed(0)}KB)`);
          } else {
            const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
            await adapter.sendText(imUserId, `📎 文件 ${fileName} (${sizeMB}MB) 过大，请到 Web 端下载。`);
          }
        } catch (e: any) {
          console.error(`[im-router] Failed to send file ${fileName}:`, e.message);
          await adapter.sendText(imUserId, `📎 文件 ${fileName} 发送失败，请到 Web 端下载。`);
        }
      }
    } catch (e: any) {
      console.error('[im-router] sendNewOutputFiles error:', e.message);
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
    const agentId = EngineAdapter.userAgentId(userId, agentName);
    const sessionId = `im-${msg.channel}-${msg.imUserId}`;
    const sessionKey = EngineAdapter.userSessionKey(userId, agentName, sessionId);

    try {
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
          if (agentName === 'default' && this.workspaceManager) {
            workspacePath = this.workspaceManager.getSubPath(userId, 'WORKSPACE');
            filesPath = this.workspaceManager.getSubPath(userId, 'FILES');
            outputsPath = this.workspaceManager.getSubPath(userId, 'OUTPUTS');
            tempPath = this.workspaceManager.getSubPath(userId, 'TEMP');
          } else if (this.dataRoot) {
            const base = agentName === 'default'
              ? path.join(this.dataRoot, 'users', userId, 'workspace')
              : path.join(this.dataRoot, 'users', userId, 'agents', agentName, 'workspace');
            workspacePath = base;
            filesPath = path.join(base, 'files');
            outputsPath = path.join(base, 'outputs');
            tempPath = path.join(base, 'temp');
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
            `- outputs/：需要交付给用户的最终成果文件（报告、文档等）\n` +
            `- temp/：你的中间产物（脚本、临时数据、草稿等）必须写入此目录\n` +
            `- 严禁在工作空间根目录直接创建文件\n\n` +
            `**安全约束（必须遵守）：**\n` +
            `- 所有文件读写操作只能在 ${workspacePath} 目录内进行\n` +
            `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
            `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
            `- Shell 命令在沙箱容器内执行，可以使用 exec 工具运行命令`;
        } catch { /* ignore */ }
      }

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
            if (event.type === 'text_delta') {
              finalContent = event.content || '';
            }
            if (event.type === 'done') resolve();
            if (event.type === 'error') reject(new Error(event.error || 'Agent error'));
          },
        ).catch(reject);
      });

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
    } catch (e: any) {
      console.error(`[im-router] Agent call error for ${userId}:`, e.message);
      await adapter.sendText(msg.imUserId, '处理消息时出错，请稍后重试。');
    }
  }
}
