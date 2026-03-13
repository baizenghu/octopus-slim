/**
 * 飞书 IM Adapter
 *
 * 使用飞书 SDK WebSocket 长连接接收消息，
 * 只处理私聊文本消息，支持消息去重和超长分段发送。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type { IMAdapter, IMIncomingMessage } from './IMAdapter';

export class FeishuAdapter implements IMAdapter {
  readonly channel = 'feishu';
  private client: lark.Client;
  private wsClient: any;
  private handler?: (msg: IMIncomingMessage) => void;
  /** 消息去重集合 */
  private processedMsgIds = new Set<string>();
  private readonly MSG_DEDUP_MAX = 1000;

  constructor(private config: { appId: string; appSecret: string }) {
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
    });
  }

  onMessage(handler: (msg: IMIncomingMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        try {
          await this.handleMessage(data);
        } catch (e: any) {
          console.error('[feishu] Message handling error:', e.message);
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.warn,
    });

    // eventDispatcher 作为 start() 的参数传入
    await this.wsClient.start({ eventDispatcher } as any);
    console.log('[feishu] WebSocket connected');
  }

  async stop(): Promise<void> {
    this.wsClient = null;
    this.processedMsgIds.clear();
    console.log('[feishu] Adapter stopped');
  }

  /** 发送文本消息，超长自动分段（2000 字符） */
  async sendText(imUserId: string, text: string): Promise<void> {
    const MAX_LEN = 2000;
    const segments: string[] = [];
    for (let i = 0; i < text.length; i += MAX_LEN) {
      segments.push(text.slice(i, i + MAX_LEN));
    }

    for (const seg of segments) {
      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: imUserId,
          msg_type: 'text',
          content: JSON.stringify({ text: seg }),
        },
      });
    }
  }

  /** 尝试删除/撤回消息（用于清理含敏感信息的消息） */
  async deleteMessage(messageId: string): Promise<void> {
    await this.client.im.message.delete({ path: { message_id: messageId } });
  }

  /** 处理收到的飞书消息事件 */
  private async handleMessage(data: any): Promise<void> {
    const msg = data?.message;
    if (!msg) return;

    // 只处理私聊文本消息
    if (msg.chat_type !== 'p2p') return;
    if (msg.message_type !== 'text') return;

    // 去重
    const msgId = msg.message_id;
    if (this.processedMsgIds.has(msgId)) return;
    this.processedMsgIds.add(msgId);
    if (this.processedMsgIds.size > this.MSG_DEDUP_MAX) {
      const first = this.processedMsgIds.values().next().value;
      if (first) this.processedMsgIds.delete(first);
    }

    // 解析消息内容
    let text = '';
    try {
      const content = JSON.parse(msg.content);
      text = content.text?.trim() || '';
    } catch {
      return;
    }
    if (!text) return;

    const senderId = data.sender?.sender_id?.open_id;
    if (!senderId) return;

    this.handler?.({
      channel: 'feishu',
      imUserId: senderId,
      imUserName: data.sender?.sender_id?.user_id,
      text,
      messageId: msgId,
    });
  }
}
