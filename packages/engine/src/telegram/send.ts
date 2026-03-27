// STUB: removed from Octopus slim build
import type { InlineKeyboardMarkup } from "@grammyjs/types";
import type { OctopusConfig } from "../config/config.js";
import type { RetryConfig } from "../infra/retry.js";
import type { PollInput } from "../polls.js";
import type { TelegramInlineButtons } from "./button-types.js";
import type { ReplyToMode } from "../config/config.js";

export type TelegramSendOpts = {
  cfg?: ReturnType<typeof import("../config/config.js").loadConfig>;
  token?: string;
  accountId?: string;
  verbose?: boolean;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  maxBytes?: number;
  api?: unknown;
  retry?: RetryConfig;
  textMode?: "markdown" | "html";
  plainText?: string;
  asVoice?: boolean;
  asVideoNote?: boolean;
  silent?: boolean;
  replyToMessageId?: number;
  quoteText?: string;
  messageThreadId?: number;
  buttons?: TelegramInlineButtons;
  isAnonymous?: boolean;
};

export type TelegramCreateForumTopicResult = {
  topicId: number;
  name: string;
  chatId: string;
};

export function buildInlineKeyboard(
  buttons?: TelegramInlineButtons,
): InlineKeyboardMarkup | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export async function sendMessageTelegram(
  to: string,
  text: string,
  opts: TelegramSendOpts = {},
): Promise<{ messageId: string; chatId: string }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function reactMessageTelegram(
  chatIdInput: string | number,
  messageIdInput: string | number,
  emoji: string,
  opts: TelegramSendOpts = {},
): Promise<{ ok: true } | { ok: false; warning: string }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function deleteMessageTelegram(
  chatIdInput: string | number,
  messageIdInput: string | number,
  opts: TelegramSendOpts = {},
): Promise<{ ok: true }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function editMessageTelegram(
  chatIdInput: string | number,
  messageIdInput: string | number,
  text: string,
  opts: TelegramSendOpts = {},
): Promise<{ messageId: string; chatId: string }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function sendStickerTelegram(
  to: string,
  fileId: string,
  opts: TelegramSendOpts = {},
): Promise<{ messageId: string; chatId: string }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function sendPollTelegram(
  to: string,
  poll: PollInput,
  opts: TelegramSendOpts = {},
): Promise<{ messageId: string; chatId: string; pollId?: string }> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function createForumTopicTelegram(
  chatId: string,
  name: string,
  opts: TelegramSendOpts = {},
): Promise<TelegramCreateForumTopicResult> {
  throw new Error('Channel not available in Octopus slim build');
}
