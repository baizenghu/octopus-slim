/** 工具调用信息（tool call 卡片数据） */
export interface ToolCallInfo {
  name: string;
  toolCallId?: string;
  args?: string;
  result?: string;
}

/** 聊天消息（前端展示用） */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  ts?: string;
  toolCalls?: ToolCallInfo[];
}

/** 聊天附件 */
export interface Attachment {
  name: string;
  content: string;  // 文本内容或 base64
  type: string;     // MIME type
  size: number;
}
