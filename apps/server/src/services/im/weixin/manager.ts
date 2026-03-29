/**
 * 微信多账号管理器
 *
 * 管理多个 WeixinAdapter 实例（每用户一个），
 * 处理启动、停止、用户绑定/解绑的生命周期。
 */

import { WeixinAdapter } from '../WeixinAdapter';
import type { IMRouter } from '../IMRouter';
import {
  loadWeixinAccount,
  saveWeixinAccount,
  deleteWeixinAccount,
  listAllAccountUserIds,
  type WeixinAccount,
} from './account';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('manager');

export class WeixinManager {
  private adapters = new Map<string, WeixinAdapter>();

  constructor(private router: IMRouter) {}

  /** 启动时加载所有已绑定用户的 adapter */
  async startAll(): Promise<void> {
    const userIds = listAllAccountUserIds();
    let started = 0;
    for (const userId of userIds) {
      try {
        await this.startUser(userId);
        started++;
      } catch (e: unknown) {
        logger.error(`Failed to start adapter for ${userId}`, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (started > 0) {
      logger.info(`IM: WeChat started ${started} adapter(s)`);
    }
  }

  /** 启动指定用户的 adapter */
  async startUser(userId: string): Promise<void> {
    // 如果已有连接，先停止
    if (this.adapters.has(userId)) {
      await this.stopUser(userId);
    }
    const account = loadWeixinAccount(userId);
    if (!account) {
      throw new Error(`No WeChat account found for user ${userId}`);
    }
    const adapter = new WeixinAdapter(userId, account);
    this.router.attach(adapter);
    await adapter.start();
    this.adapters.set(userId, adapter);
  }

  /** 停止指定用户的 adapter */
  async stopUser(userId: string): Promise<void> {
    const adapter = this.adapters.get(userId);
    if (adapter) {
      await adapter.stop();
      this.adapters.delete(userId);
    }
  }

  /** 用户绑定微信（扫码成功后调用） */
  async bindUser(userId: string, account: WeixinAccount): Promise<void> {
    saveWeixinAccount(userId, account);
    await this.startUser(userId);
  }

  /** 用户解绑微信 */
  async unbindUser(userId: string): Promise<void> {
    await this.stopUser(userId);
    deleteWeixinAccount(userId);
  }

  /** 检查用户是否已连接 */
  isUserConnected(userId: string): boolean {
    return this.adapters.has(userId);
  }

  /** 向指定用户的微信推送消息（需用户之前发过消息才有 contextToken） */
  async sendToUser(userId: string, text: string): Promise<number> {
    const adapter = this.adapters.get(userId);
    if (!adapter) return 0;
    return adapter.broadcastText(text);
  }

  /** 向指定用户的微信推送文件 */
  async sendFileToUser(userId: string, filePath: string, fileName: string): Promise<number> {
    const adapter = this.adapters.get(userId);
    if (!adapter) return 0;
    return adapter.broadcastFile(filePath, fileName);
  }

  /** 停止所有 adapter */
  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop().catch(err => logger.warn('停止微信 adapter 失败', { error: err?.message || String(err) }));
    }
    this.adapters.clear();
  }
}
