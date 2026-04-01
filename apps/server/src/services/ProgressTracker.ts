/**
 * ProgressTracker — Agent 事件流进度提取器（服务端）
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
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '\u2026' : trimmed;
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
          const resultStr = (event.toolResult ?? '').trim();
          entry = {
            timestamp: new Date(),
            type: 'tool_result',
            summary: truncate(`[${event.toolName ?? 'tool'}] \u2192 ${resultStr}`),
          };
        } else {
          entry = {
            timestamp: new Date(),
            type: 'tool_call',
            summary: truncate(`[${event.toolName ?? 'tool'}] \u8c03\u7528\u4e2d\u2026`),
          };
        }
        break;
      }
      default:
        return;
    }

    if (!entry) return;

    this.entries.push(entry);
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
    if (this.entries.length === 0) return '\uff08\u6682\u65e0\u8fdb\u5ea6\uff09';
    return this.entries
      .map((e) => {
        const timeStr = e.timestamp.toTimeString().slice(0, 8);
        return `[${timeStr}] ${e.summary}`;
      })
      .join('\n');
  }
}
