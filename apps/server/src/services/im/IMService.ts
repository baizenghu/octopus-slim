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
        console.log('   IM: Feishu adapter started');
      } catch (e: any) {
        console.error('   IM: Feishu adapter failed to start:', e.message);
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
      await adapter.stop().catch(() => {});
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
        console.error(`[im-service] Failed to send to ${binding.channel}/${binding.imUserId}: ${msg}`);
      }
    }

    // 微信渠道：通过 WeixinManager 检查该用户是否有微信连接
    // （微信不走 IMUserBinding 表，直接通过 adapter 发送）
    // 注：微信消息是被动回复，sendToUser 场景下暂不支持微信主动推送

    return sent;
  }
}
