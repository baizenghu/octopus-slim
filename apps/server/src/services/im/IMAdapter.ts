/**
 * IM Adapter 通用接口
 *
 * 每个 IM 平台（飞书、网讯通等）实现此接口，
 * IMRouter 通过统一接口处理消息路由。
 */

export interface IMIncomingMessage {
  /** 渠道标识: 'feishu' | 'wechat' */
  channel: string;
  /** 平台用户 ID（飞书 open_id 等） */
  imUserId: string;
  /** 显示名 */
  imUserName?: string;
  /** 消息文本 */
  text: string;
  /** 消息 ID（去重） */
  messageId: string;
}

export interface IMAdapter {
  readonly channel: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(imUserId: string, text: string): Promise<void>;
  onMessage(handler: (msg: IMIncomingMessage) => void): void;
  /** 尝试删除/撤回指定消息（可选实现，用于安全场景如删除含密码的消息） */
  deleteMessage?(messageId: string): Promise<void>;
  /** 发送文件（可选实现，平台不支持时回退到 sendText 发文件名） */
  sendFile?(imUserId: string, filePath: string, fileName: string): Promise<void>;
}
