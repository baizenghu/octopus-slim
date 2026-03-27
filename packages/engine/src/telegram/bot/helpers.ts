// STUB: removed from Octopus slim build
import type { Chat, Message, UserFromGetMe } from "@grammyjs/types";
import type { NormalizedLocation } from "../../channels/location.js";
import type {
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "../../config/types.js";
import type { NormalizedAllowFrom } from "../../line/bot-access.js";
import type { TelegramStreamMode } from "./types.js";

export type TelegramThreadSpec = {
  id?: number;
  scope: "dm" | "forum" | "none";
};

export type TelegramTextEntity = NonNullable<Message["entities"]>[number];

export type TelegramReplyTarget = {
  id?: string;
  sender: string;
  body: string;
  kind: "reply" | "quote";
  forwardedFrom?: TelegramForwardedContext;
};

export type TelegramForwardedContext = {
  from: string;
  date?: number;
  fromType: string;
  fromId?: string;
  fromUsername?: string;
  fromTitle?: string;
  fromSignature?: string;
  fromChatType?: Chat["type"];
  fromMessageId?: number;
};

type TelegramTextLinkEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

export async function resolveTelegramGroupAllowFromContext(params: {
  chatId: string | number;
  accountId?: string;
  isGroup?: boolean;
  isForum?: boolean;
  messageThreadId?: number | null;
  groupAllowFrom?: Array<string | number>;
  resolveTelegramGroupConfig: (
    chatId: string | number,
    messageThreadId?: number,
  ) => {
    groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
    topicConfig?: TelegramTopicConfig;
  };
}): Promise<{
  resolvedThreadId?: number;
  dmThreadId?: number;
  storeAllowFrom: string[];
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
  topicConfig?: TelegramTopicConfig;
  groupAllowOverride?: Array<string | number>;
  effectiveGroupAllow: NormalizedAllowFrom;
  hasGroupAllowOverride: boolean;
}> {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramForumThreadId(params: {
  isForum?: boolean;
  messageThreadId?: number | null;
}): number | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramThreadSpec(params: {
  isGroup: boolean;
  isForum?: boolean;
  messageThreadId?: number | null;
}): TelegramThreadSpec {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildTelegramThreadParams(
  thread?: TelegramThreadSpec | null,
): { message_thread_id: number } | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildTypingThreadParams(
  messageThreadId?: number,
): { message_thread_id: number } | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramStreamMode(telegramCfg?: {
  streaming?: unknown;
  streamMode?: unknown;
}): TelegramStreamMode {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildTelegramGroupPeerId(chatId: number | string, messageThreadId?: number): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramDirectPeerId(params: {
  chatId: number | string;
  senderId?: number | string | null;
}): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildTelegramGroupFrom(chatId: number | string, messageThreadId?: number): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildTelegramParentPeer(params: {
  isGroup: boolean;
  resolvedThreadId?: number;
  chatId: number | string;
}): { kind: "group"; id: string } | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildSenderName(msg: Message): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramMediaPlaceholder(
  msg:
    | Pick<Message, "photo" | "video" | "video_note" | "audio" | "voice" | "document" | "sticker">
    | undefined
    | null,
): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildSenderLabel(msg: Message, senderId?: number | string): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildGroupLabel(
  msg: Message,
  chatId: number | string,
  messageThreadId?: number,
): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function getTelegramTextParts(
  msg: Pick<Message, "text" | "caption" | "entities" | "caption_entities">,
): {
  text: string;
  entities: TelegramTextEntity[];
} {
  throw new Error('Channel not available in Octopus slim build');
}

export function hasBotMention(msg: Message, botUsername: string): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function expandTextLinks(text: string, entities?: TelegramTextLinkEntity[] | null): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramReplyId(raw?: string): number | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function describeReplyTarget(msg: Message): TelegramReplyTarget | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeForwardedContext(msg: Message): TelegramForwardedContext | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function extractTelegramLocation(msg: Message): NormalizedLocation | null {
  throw new Error('Channel not available in Octopus slim build');
}
