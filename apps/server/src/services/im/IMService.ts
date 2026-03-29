/**
 * IM Service 生命周期管理
 *
 * 根据环境变量自动启动可用的 IM Adapter，
 * 统一管理所有 adapter 的生命周期。
 */

import type { IMAdapter } from './IMAdapter';
import { IMRouter } from './IMRouter';
import { FeishuAdapter } from './FeishuAdapter';
import { WeixinManager } from './weixin/manager';
import type { EngineAdapter } from '../EngineAdapter';
import type { AuthService } from '@octopus/auth';
import type { AppPrismaClient } from '../../types/prisma';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AuditLogger } from '@octopus/audit';
import { createLogger } from '../../utils/logger';

const logger = createLogger('IMService');

export class IMService {
  private adapters: IMAdapter[] = [];
  private router: IMRouter;
  private prisma: AppPrismaClient;
  /** 微信多账号管理器（外部可访问，供 API 路由使用） */
  weixinManager: WeixinManager | null = null;

  constructor(params: {
    prisma: AppPrismaClient;
    bridge: EngineAdapter;
    authService: AuthService;
    ensureAgent: (userId: string, agentName: string) => Promise<void>;
    dataRoot?: string;
    workspaceManager?: WorkspaceManager;
    auditLogger?: AuditLogger;
  }) {
    this.prisma = params.prisma;
    this.router = new IMRouter(
      params.prisma,
      params.bridge,
      params.authService,
      params.ensureAgent,
      params.dataRoot,
      params.workspaceManager,
      params.auditLogger,
    );
  }

  /** 启动所有已配置的 IM Adapter */
  async start(): Promise<void> {
    // 飞书 Adapter
    const feishuAppId = process.env.FEISHU_APP_ID;
    const feishuAppSecret = process.env.FEISHU_APP_SECRET;
    if (feishuAppId && feishuAppSecret) {
      const feishu = new FeishuAdapter({ appId: feishuAppId, appSecret: feishuAppSecret });
      this.router.attach(feishu);
      try {
        await feishu.start();
        this.adapters.push(feishu);
        logger.info('   IM: Feishu adapter started');
      } catch (e: unknown) {
        logger.error('   IM: Feishu adapter failed to start:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
      }
    }

    // 微信多账号 Adapter
    if (process.env.WEIXIN_ENABLED === 'true') {
      this.weixinManager = new WeixinManager(this.router);
      await this.weixinManager.startAll();
    }
  }

  /** 停止所有 adapter */
  async stop(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.stop().catch(err => logger.warn('停止 IM adapter 失败', { error: err?.message || String(err) }));
    }
    this.adapters = [];
    await this.weixinManager?.stopAll();
  }

  /**
   * 向指定企业用户发送消息（查询所有 IM 绑定并逐一发送）
   */
  async sendToUser(userId: string, text: string): Promise<number> {
    if (this.adapters.length === 0 && !this.weixinManager) return 0;

    // 查询飞书等渠道的 IM 绑定
    const bindings = await this.prisma.iMUserBinding.findMany({
      where: { userId },
    });

    let sent = 0;
    for (const binding of bindings) {
      const adapter = this.adapters.find(a => a.channel === binding.channel);
      if (!adapter) continue;
      try {
        await adapter.sendText(binding.imUserId, text);
        sent++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[im-service] Failed to send to ${binding.channel}/${binding.imUserId}: ${msg}`);
      }
    }

    // 微信渠道：通过 WeixinManager 主动推送
    // 前提：用户之前在微信中发过消息（adapter 缓存了 contextToken）
    if (this.weixinManager) {
      try {
        const weixinSent = await this.weixinManager.sendToUser(userId, text);
        sent += weixinSent;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[im-service] Failed to send to wechat/${userId}: ${msg}`);
      }
    }

    return sent;
  }

  /**
   * 向指定企业用户发送文件（查询所有 IM 绑定并逐一发送）
   */
  async sendFileToUser(userId: string, filePath: string, fileName: string): Promise<number> {
    if (this.adapters.length === 0 && !this.weixinManager) return 0;

    const bindings = await this.prisma.iMUserBinding.findMany({
      where: { userId },
    });

    let sent = 0;
    for (const binding of bindings) {
      const adapter = this.adapters.find(a => a.channel === binding.channel);
      if (!adapter) continue;
      try {
        if (adapter.sendFile) {
          await adapter.sendFile(binding.imUserId, filePath, fileName);
          sent++;
        } else {
          await adapter.sendText(binding.imUserId, `📎 文件 ${fileName}，请到 Web 端下载。`);
          sent++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[im-service] Failed to send file to ${binding.channel}/${binding.imUserId}: ${msg}`);
      }
    }

    // 微信渠道
    if (this.weixinManager) {
      try {
        const weixinSent = await this.weixinManager.sendFileToUser(userId, filePath, fileName);
        sent += weixinSent;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[im-service] Failed to send file to wechat/${userId}: ${msg}`);
      }
    }

    return sent;
  }

  /**
   * 向指定企业用户发送文件（查询所有 IM 绑定并逐一发送）
   */
  async sendFileToUser(userId: string, filePath: string, fileName: string): Promise<number> {
    if (this.adapters.length === 0 && !this.weixinManager) return 0;

    const bindings = await this.prisma.iMUserBinding.findMany({
      where: { userId },
    });

    let sent = 0;
    for (const binding of bindings) {
      const adapter = this.adapters.find(a => a.channel === binding.channel);
      if (!adapter) continue;
      try {
        if (adapter.sendFile) {
          await adapter.sendFile(binding.imUserId, filePath, fileName);
          sent++;
        } else {
          await adapter.sendText(binding.imUserId, `📎 文件 ${fileName}，请到 Web 端下载。`);
          sent++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[im-service] Failed to send file to ${binding.channel}/${binding.imUserId}: ${msg}`);
      }
    }

    // 微信渠道
    if (this.weixinManager) {
      try {
        const weixinSent = await this.weixinManager.sendFileToUser(userId, filePath, fileName);
        sent += weixinSent;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[im-service] Failed to send file to wechat/${userId}: ${msg}`);
      }
    }

    return sent;
  }
}
