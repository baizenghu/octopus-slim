/**
 * IM Service 生命周期管理
 *
 * 根据环境变量自动启动可用的 IM Adapter，
 * 统一管理所有 adapter 的生命周期。
 */

import type { IMAdapter } from './IMAdapter';
import { IMRouter } from './IMRouter';
import { FeishuAdapter } from './FeishuAdapter';
import type { EngineAdapter } from '../EngineAdapter';
import type { AuthService } from '@octopus/auth';
import type { AppPrismaClient } from '../../types/prisma';

export class IMService {
  private adapters: IMAdapter[] = [];
  private router: IMRouter;
  private prisma: AppPrismaClient;

  constructor(params: {
    prisma: AppPrismaClient;
    bridge: EngineAdapter;
    authService: AuthService;
    ensureAgent: (userId: string, agentName: string) => Promise<void>;
  }) {
    this.prisma = params.prisma;
    this.router = new IMRouter(
      params.prisma,
      params.bridge,
      params.authService,
      params.ensureAgent,
    );
  }

  /** 启动所有已配置的 IM Adapter */
  async start(): Promise<void> {
    // 飞书 Adapter：检查环境变量
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
  }

  /** 停止所有 adapter */
  async stop(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.stop().catch(() => {});
    }
    this.adapters = [];
  }

  /**
   * 向指定企业用户发送消息（查询所有 IM 绑定并逐一发送）
   *
   * @param userId 企业用户 ID
   * @param text 消息文本
   * @returns 成功发送的渠道数
   */
  async sendToUser(userId: string, text: string): Promise<number> {
    if (this.adapters.length === 0) return 0;

    // 查询该用户的所有 IM 绑定
    const bindings = await this.prisma.iMUserBinding.findMany({
      where: { userId },
    });
    if (bindings.length === 0) return 0;

    let sent = 0;
    for (const binding of bindings) {
      // 找到对应 channel 的 adapter
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
    return sent;
  }
}
