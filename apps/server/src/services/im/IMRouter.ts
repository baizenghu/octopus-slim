/**
 * IM 消息路由
 *
 * 处理 IM 消息的核心逻辑：
 * - /bind 用户名 密码 → 绑定 IM 用户到企业账户
 * - /unbind → 解除绑定
 * - /status → 查看绑定状态
 * - 普通消息 → 路由到 callAgent
 */

import type { IMAdapter, IMIncomingMessage } from './IMAdapter';
import { OctopusBridge } from '../OctopusBridge';
import type { AuthService } from '@octopus/auth';
import type { AppPrismaClient } from '../../types/prisma';
import { randomUUID } from 'crypto';

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
    private bridge: OctopusBridge,
    private authService: AuthService,
    private ensureAgent: (userId: string, agentName: string) => Promise<void>,
  ) {}

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

  /** 普通消息路由到 callAgent */
  private async routeToAgent(
    adapter: IMAdapter,
    userId: string,
    msg: IMIncomingMessage,
  ): Promise<void> {
    const agentName = 'default';
    const agentId = OctopusBridge.userAgentId(userId, agentName);
    const sessionId = `im-${msg.channel}-${msg.imUserId}`;
    const sessionKey = OctopusBridge.userSessionKey(userId, agentName, sessionId);

    try {
      await this.ensureAgent(userId, agentName);

      // 调用 agent，等待 done 事件收集完整回复
      let finalContent = '';

      await new Promise<void>((resolve, reject) => {
        this.bridge.callAgent(
          {
            message: msg.text,
            agentId,
            sessionKey,
            deliver: false,
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
    } catch (e: any) {
      console.error(`[im-router] Agent call error for ${userId}:`, e.message);
      await adapter.sendText(msg.imUserId, '处理消息时出错，请稍后重试。');
    }
  }
}
