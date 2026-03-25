/**
 * 集中管理所有内容净化正则，确保后端各处一致。
 *
 * 使用位置：
 * - GET /history/:sessionId  — 用户/助手消息净化
 * - autoGenerateTitle()      — 从首条消息生成标题
 * - POST / (非流式)          — 响应净化
 * - 前端 filterInternalTags  — 展示层兜底（正则需保持同步）
 */

const MEMORY_TAG_RE = /<relevant-memories>[\s\S]*?<\/relevant-memories>/g;
const UNTRUSTED_DATA_RE = /\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g;
const TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{4}-\d{2}-\d{2}[^\]]*\]\s*/m;
const TIMESTAMP_PREFIX_GLOBAL_RE = /^\[[A-Za-z]{3}\s\d{4}-\d{2}-\d{2}.*?\]\s*/gm;
const SKILL_INJECT_RE = /^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/gm;
const LESSON_PREFIX_RE = /^\/lesson\s+/m;
const ATTACHMENT_PREFIX_RE = /^\[用户上传了 \d+ 个文件，已保存到工作空间\]\n(?:- .+\n?)+\n?/m;
// Legacy: 保留用于清理旧 session 中残留的 reminder 标签，新提醒走 cron 工具
// Legacy: 保留用于清理旧 session 中残留的 reminder 标签，新提醒走 cron 工具
const REMINDER_TAG_RE = /<enterprise-reminder[^>]*\/?>(<\/enterprise-reminder>)?/g;
const RUNTIME_CONTEXT_RE = /Octopus runtime context/;
const INTERNAL_EVENT_RE = /\[Internal task completion event\]/;
// 兼容多种模型的 thinking 标签格式（与引擎 reasoning-tags.ts 保持一致）
const THINKING_TAG_RE = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\b[^<>]*>/gi;

import { stripReasoningTagsFromText } from './reasoning-tags';

/** 净化用户消息（history 和 title 共用） */
export function sanitizeUserContent(content: string): string {
  return content
    .replace(MEMORY_TAG_RE, '')
    .replace(UNTRUSTED_DATA_RE, '')
    .replace(TIMESTAMP_PREFIX_RE, '')
    .replace(SKILL_INJECT_RE, '')
    .replace(LESSON_PREFIX_RE, '')
    .replace(ATTACHMENT_PREFIX_RE, '')
    .trim();
}

/** 净化助手消息（剔除 reminder 标签 + 分离 thinking，用引擎方式处理各种模型标签） */
export function sanitizeAssistantContent(content: string): { content: string; thinking?: string } {
  let cleaned = content.replace(REMINDER_TAG_RE, '').trim();

  // 提取 thinking 内容（兼容 <think>/<thinking>/<thought>/<antthinking>）
  THINKING_TAG_RE.lastIndex = 0;
  const thinkingParts: string[] = [];
  let inThink = false;
  let thinkStart = 0;
  for (const match of cleaned.matchAll(THINKING_TAG_RE)) {
    const isClose = match[1] === '/';
    if (!inThink && !isClose) {
      inThink = true;
      thinkStart = (match.index ?? 0) + match[0].length;
    } else if (inThink && isClose) {
      thinkingParts.push(cleaned.slice(thinkStart, match.index ?? 0).trim());
      inThink = false;
    }
  }
  const thinking = thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined;

  // 用引擎方式剥离所有 thinking + final 标签
  cleaned = stripReasoningTagsFromText(cleaned, { mode: 'preserve', trim: 'both' });
  return { content: cleaned, thinking };
}

/** 净化非流式响应（purified — 剔除记忆标签/时间戳/不可信数据） */
export function sanitizeResponse(content: string): string {
  return content
    .replace(MEMORY_TAG_RE, '')
    .replace(TIMESTAMP_PREFIX_GLOBAL_RE, '')
    .replace(UNTRUSTED_DATA_RE, '')
    .trim();
}

/** 检测应完全隐藏的内部消息 */
export function isInternalMessage(content: string): boolean {
  return RUNTIME_CONTEXT_RE.test(content) || INTERNAL_EVENT_RE.test(content);
}
