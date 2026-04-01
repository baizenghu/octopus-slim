/**
 * progress-tracker.ts — Agent 事件流进度提取器
 *
 * 从 Agent 事件流中提取简要摘要，用于后台任务的进度展示。
 * 维护 ring buffer（最多 maxEntries 条），每条截断到 100 字符。
 */

const SUMMARY_MAX_CHARS = 100;

export interface ProgressEntry {
  timestamp: Date;
  type: 'text' | 'tool_call' | 'tool_result';
  /** 截断到 SUMMARY_MAX_CHARS 字符 */
  summary: string;
}

function truncate(s: string, max = SUMMARY_MAX_CHARS): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed;
}

export class ProgressTracker {
  private entries: ProgressEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  /**
   * 处理 Agent 事件，提取并存储进度摘要。
   */
  onEvent(event: {
    type: string;
    content?: string;
    toolName?: string;
    toolResult?: string;
  }): void {
    let entry: ProgressEntry | null = null;

    switch (event.type) {
      case 'text_delta': {
        const text = (event.content ?? '').trim();
        if (!text) return;
        entry = {
          timestamp: new Date(),
          type: 'text',
          summary: truncate(text),
        };
        break;
      }
      case 'tool_call': {
        if (event.toolResult) {
          // tool 完成：记录 result 摘要
          const resultStr = (event.toolResult ?? '').trim();
          entry = {
            timestamp: new Date(),
            type: 'tool_result',
            summary: truncate(`[${event.toolName ?? 'tool'}] → ${resultStr}`),
          };
        } else {
          // tool 开始：记录调用摘要
          entry = {
            timestamp: new Date(),
            type: 'tool_call',
            summary: truncate(`[${event.toolName ?? 'tool'}] 调用中…`),
          };
        }
        break;
      }
      default:
        // lifecycle / thinking / done / error — 不记录
        return;
    }

    if (!entry) return;

    this.entries.push(entry);
    // ring buffer：超上限时移除最旧
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /**
   * 获取最近 n 条进度（默认全部）。
   */
  getRecent(n?: number): ProgressEntry[] {
    if (n === undefined) return this.entries.slice();
    return this.entries.slice(-n);
  }

  /**
   * 生成人类可读的进度摘要文本。
   */
  getSummary(): string {
    if (this.entries.length === 0) return '（暂无进度）';
    return this.entries
      .map((e) => {
        const timeStr = e.timestamp.toTimeString().slice(0, 8);
        return `[${timeStr}] ${e.summary}`;
      })
      .join('\n');
  }
}
