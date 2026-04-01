import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, Usage } from "@mariozechner/pi-ai";

export const CHARS_PER_TOKEN_DEFAULT = 4;
export const CHARS_PER_TOKEN_CHINESE = 2;
export const IMAGE_TOKEN_ESTIMATE = 2000;

const CJK_THRESHOLD = 0.3;
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

/**
 * Detect whether text is predominantly CJK and return a chars-per-token ratio.
 * Chinese characters typically map ~1:1 to tokens, so we use a smaller divisor.
 */
function detectCharsPerToken(text: string): number {
  if (!text || text.length === 0) return CHARS_PER_TOKEN_DEFAULT;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
  return cjkRatio > CJK_THRESHOLD ? CHARS_PER_TOKEN_CHINESE : CHARS_PER_TOKEN_DEFAULT;
}

/**
 * Rough-estimate the token count for a single message by dividing char count
 * by a language-aware ratio. Images are counted as a fixed token budget.
 */
export function roughTokenCountForMessage(message: AgentMessage): number {
  // AgentMessage may include custom message types without content; treat as Message for estimation.
  const msg = message as Message;
  if (!msg.content || !Array.isArray(msg.content)) return 0;

  let chars = 0;
  let hasImage = false;
  const textParts: string[] = [];

  for (const block of msg.content as Array<{ type: string; text?: string }>) {
    if (block.type === "text" && typeof block.text === "string") {
      chars += block.text.length;
      textParts.push(block.text);
    } else if (block.type === "image") {
      hasImage = true;
    }
  }

  const joinedText = textParts.join("\n");
  const charsPerToken = detectCharsPerToken(joinedText);
  const textTokens = Math.ceil(chars / charsPerToken);
  const imageTokens = hasImage ? IMAGE_TOKEN_ESTIMATE : 0;
  return textTokens + imageTokens;
}

/**
 * Extract usage from an assistant message. Returns null if the message is not
 * an assistant message, or if usage is zero (indicating no real API call was
 * made — e.g. stream partial or synthetic message).
 */
function getNonzeroUsage(message: AgentMessage): Usage | null {
  if (message.role !== "assistant") return null;

  // After narrowing, message is AssistantMessage with required usage field.
  const usage = (message as AssistantMessage).usage;
  if (!usage || typeof usage.input !== "number") return null;

  const total = usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  if (total === 0) return null;

  return usage;
}

/**
 * Compute the token count from a usage object. Uses the sum of all token fields
 * (input + output + cacheRead + cacheWrite) as the anchor value, since this
 * represents the total tokens consumed up to and including that API call.
 */
function getTokenCountFromUsage(usage: Usage): number {
  return usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * Estimate total token count for a message list using API usage anchoring.
 *
 * Strategy (inspired by Claude Code):
 * 1. Find the LAST assistant message with nonzero usage — that's our "anchor".
 *    Its usage fields give us a precise token count up to that point.
 * 2. For any messages AFTER the anchor, rough-estimate with char/token ratio.
 * 3. If no anchor exists, fall back to rough estimation for all messages.
 */
export function tokenCountWithEstimation(messages: AgentMessage[]): number {
  // Scan backwards to find the last assistant with real usage
  let anchorIndex = -1;
  let anchorTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const usage = getNonzeroUsage(msg);
    if (usage) {
      anchorIndex = i;
      anchorTokens = getTokenCountFromUsage(usage);
      break;
    }
  }

  // No anchor: fall back to pure rough estimation
  if (anchorIndex === -1) {
    let total = 0;
    for (const msg of messages) {
      total += roughTokenCountForMessage(msg);
    }
    return total;
  }

  // Rough-estimate only the delta (messages after anchor)
  let delta = 0;
  for (let i = anchorIndex + 1; i < messages.length; i++) {
    delta += roughTokenCountForMessage(messages[i]!);
  }

  return anchorTokens + delta;
}
