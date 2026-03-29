/**
 * 结构化日志工具
 *
 * 统一日志格式，便于后续接入日志收集系统（如 ELK、Loki）。
 * 目前基于 console 实现，可后续替换为 winston/pino。
 * 生产环境同时输出 JSON 日志到文件（LOG_DIR 或 .dev-logs/octopus.log）。
 */

import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';

const LOG_DIR = process.env['LOG_DIR'] ?? path.join(process.cwd(), '.dev-logs');

function writeToFile(level: string, module: string, message: string, data?: Record<string, unknown>): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      module,
      message,
      ...(data ? { data } : {}),
    });
    appendFileSync(path.join(LOG_DIR, 'octopus.log'), line + '\n');
  } catch { /* best-effort file logging */ }
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: string;
  /** 附加数据（错误信息、请求 ID 等） */
  data?: Record<string, unknown>;
}

function formatLog(entry: LogEntry): string {
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${dataStr}`;
}

/**
 * 创建模块级 logger 实例
 *
 * @param module - 模块名称，如 'gateway', 'agents', 'mcp'
 */
export function createLogger(module: string) {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      module,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    const formatted = formatLog(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        if (process.env['LOG_LEVEL'] === 'debug') {
          console.log(formatted);
        }
        break;
      default:
        console.log(formatted);
    }

    writeToFile(level, module, message, data);
  }

  return {
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
  };
}

/** 全局默认 logger */
export const logger = createLogger('gateway');
