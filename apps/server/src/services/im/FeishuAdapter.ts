/**
 * 飞书 IM Adapter
 *
 * 使用飞书 SDK WebSocket 长连接接收消息，
 * 只处理私聊文本消息，支持消息去重和超长分段发送。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as lark from '@larksuiteoapi/node-sdk';
import type { IMAdapter, IMIncomingMessage } from './IMAdapter';
import { createLogger } from '../../utils/logger';

const logger = createLogger('FeishuAdapter');

export class FeishuAdapter implements IMAdapter {
  readonly channel = 'feishu';
  private client: lark.Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'im.message.receive_v1': async (data: any) => {
        try {
          await this.handleMessage(data);
        } catch (e: unknown) {
          logger.error('[feishu] Message handling error:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
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
    logger.info('[feishu] WebSocket connected');
  }

  async stop(): Promise<void> {
    this.wsClient = null;
    this.processedMsgIds.clear();
    logger.info('[feishu] Adapter stopped');
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

  /** 发送文件消息：先上传到飞书，再发文件消息 */
  async sendFile(imUserId: string, filePath: string, fileName: string): Promise<void> {
    const ext = path.extname(fileName).toLowerCase();
    const fileTypeMap: Record<string, string> = {
      '.pdf': 'pdf', '.doc': 'doc', '.docx': 'doc',
      '.xls': 'xls', '.xlsx': 'xls', '.ppt': 'ppt', '.pptx': 'ppt',
    };
    const fileType = fileTypeMap[ext] || 'stream';

    // RFC 5987: 非 ASCII 文件名需要 percent-encoding
    const safeName = /^[\x20-\x7E]+$/.test(fileName) ? fileName : encodeURIComponent(fileName);

    // Step 1: 上传文件到飞书
    const uploadRes = await this.client.im.file.create({
      data: {
        file_type: fileType,
        file_name: safeName,
        file: fs.createReadStream(filePath),
      } as any,
    });

    const resAny = uploadRes as Record<string, unknown>;
    if (resAny['code'] !== undefined && resAny['code'] !== 0) {
      throw new Error(`飞书文件上传失败: ${resAny['msg'] || `code ${resAny['code']}`}`);
    }
    const resData = resAny['data'] as Record<string, unknown> | undefined;
    const fileKey = resAny['file_key'] ?? resData?.['file_key'];
    if (!fileKey) throw new Error('飞书文件上传失败: 未返回 file_key');

    // Step 2: 发送文件消息
    await this.client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: imUserId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
  }

  /** 尝试删除/撤回消息（用于清理含敏感信息的消息） */
  async deleteMessage(messageId: string): Promise<void> {
    await this.client.im.message.delete({ path: { message_id: messageId } });
  }

  /** 处理收到的飞书消息事件 */
  private async handleMessage(data: Record<string, unknown>): Promise<void> {
    const msg = data['message'] as Record<string, unknown> | undefined;
    if (!msg) return;

    // 只处理私聊文本消息
    if (msg['chat_type'] !== 'p2p') return;
    if (msg['message_type'] !== 'text') return;

    // 去重
    const msgId = msg['message_id'] as string;
    if (this.processedMsgIds.has(msgId)) return;
    this.processedMsgIds.add(msgId);
    if (this.processedMsgIds.size > this.MSG_DEDUP_MAX) {
      const first = this.processedMsgIds.values().next().value;
      if (first) this.processedMsgIds.delete(first);
    }

    // 解析消息内容
    let text = '';
    try {
      const content = JSON.parse(msg['content'] as string) as { text?: string };
      text = content.text?.trim() || '';
    } catch {
      return;
    }
    if (!text) return;

    const sender = data['sender'] as Record<string, unknown> | undefined;
    const senderId = (sender?.['sender_id'] as Record<string, unknown> | undefined)?.['open_id'] as string | undefined;
    if (!senderId) return;
    const senderIdObj = sender?.['sender_id'] as Record<string, unknown> | undefined;

    this.handler?.({
      channel: 'feishu',
      imUserId: senderId,
      imUserName: senderIdObj?.['user_id'] as string | undefined,
      text,
      messageId: msgId,
    });
  }
}
