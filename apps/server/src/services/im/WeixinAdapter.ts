/**
 * 微信 IM Adapter
 *
 * 通过 ilink bot API long-poll 接收消息，HTTP POST 发送消息。
 * 实现 IMAdapter 接口，与 FeishuAdapter 平级。
 *
 * 移植自 OpenClaw weixin plugin (MIT)。
 */

import type { IMAdapter, IMIncomingMessage } from './IMAdapter';
import type { WeixinAccount } from './weixin/account';
import { loadSyncBuf, saveSyncBuf } from './weixin/account';
import { getUpdates, sendTextMessage, markdownToPlainText, splitText } from './weixin/api';
import { uploadAndSendFile } from './weixin/cdn';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class WeixinAdapter implements IMAdapter {
  readonly channel = 'wechat';

  private running = false;
  private abortController: AbortController | null = null;
  private messageHandler: ((msg: IMIncomingMessage) => void) | null = null;
  private cursor = '';
  private retryCount = 0;
  private contextTokens = new Map<string, string>();
  private processedMsgIds = new Set<string>();
  private readonly MSG_DEDUP_MAX = 1000;

  constructor(private account: WeixinAccount) {
    this.cursor = loadSyncBuf();
  }

  // --- IMAdapter 接口实现 ---

  async start(): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();
    this.pollLoop();
    console.log('[wechat] Long-poll started');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    this.processedMsgIds.clear();
    console.log('[wechat] Adapter stopped');
  }

  async sendText(imUserId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(imUserId);
    if (!contextToken) {
      console.warn(`[wechat] 无法回复 ${imUserId}，缺少 contextToken（需等待用户发一条消息）`);
      return;
    }
    const plainText = markdownToPlainText(text);
    const chunks = splitText(plainText, 4000);
    for (const chunk of chunks) {
      await sendTextMessage({
        baseUrl: this.account.baseUrl,
        token: this.account.token,
        to: imUserId,
        text: chunk,
        contextToken,
      });
    }
  }

  onMessage(handler: (msg: IMIncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  // deleteMessage 不实现（微信 bot 无法撤回用户消息）

  async sendFile(imUserId: string, filePath: string, _fileName: string): Promise<void> {
    const contextToken = this.contextTokens.get(imUserId);
    if (!contextToken) {
      console.warn(`[wechat] 无法发送文件给 ${imUserId}，缺少 contextToken`);
      return;
    }
    await uploadAndSendFile({
      filePath,
      to: imUserId,
      apiOpts: { baseUrl: this.account.baseUrl, token: this.account.token },
      cdnBaseUrl: this.account.cdnBaseUrl,
      contextToken,
    });
  }

  // --- 内部方法 ---

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const result = await getUpdates({
          baseUrl: this.account.baseUrl,
          token: this.account.token,
          cursor: this.cursor,
          abortSignal: this.abortController?.signal,
        });

        // Session 过期（errcode -14）
        if (result.errcode === -14) {
          console.error('[wechat] Session 已过期，请执行 ./start.sh weixin-login 重新扫码');
          await sleep(3600000); // 暂停 1 小时
          continue;
        }

        // 更新并持久化游标
        if (result.cursor) {
          this.cursor = result.cursor;
          saveSyncBuf(result.cursor);
        }
        this.retryCount = 0;

        for (const msg of result.msgs) {
          // 消息去重
          if (this.processedMsgIds.has(msg.msgId)) continue;
          this.processedMsgIds.add(msg.msgId);
          if (this.processedMsgIds.size > this.MSG_DEDUP_MAX) {
            // 清理旧消息 ID（保留最近一半）
            const ids = Array.from(this.processedMsgIds);
            this.processedMsgIds = new Set(ids.slice(Math.floor(ids.length / 2)));
          }

          // 缓存 contextToken
          this.contextTokens.set(msg.fromUserId, msg.contextToken);

          // 交给 IMRouter
          this.messageHandler?.({
            channel: 'wechat',
            imUserId: msg.fromUserId,
            text: msg.text,
            messageId: msg.msgId,
          });
        }
      } catch (err) {
        if (!this.running) break;
        if (err instanceof Error && err.name === 'AbortError') break;

        this.retryCount++;
        if (this.retryCount <= 3) {
          const wait = Math.min(2000 * Math.pow(2, this.retryCount), 30000);
          console.warn(`[wechat] 连接断开，${wait / 1000}s 后重试 (${this.retryCount}/3)`);
          await sleep(wait);
        } else {
          console.error('[wechat] 连接失败，已重试3次，30s 后继续');
          await sleep(30000);
          this.retryCount = 0;
        }
      }
    }
  }
}
