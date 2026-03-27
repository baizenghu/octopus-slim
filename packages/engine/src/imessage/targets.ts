// STUB: removed from Octopus slim build

import type { ParsedChatTarget, ChatSenderAllowParams } from "./target-parsing-helpers.js";

export type IMessageService = "imessage" | "sms" | "auto";

export type IMessageTarget =
  | { kind: "chat_id"; chatId: number }
  | { kind: "chat_guid"; chatGuid: string }
  | { kind: "chat_identifier"; chatIdentifier: string }
  | { kind: "handle"; to: string; service: IMessageService };

export type IMessageAllowTarget = ParsedChatTarget | { kind: "handle"; handle: string };

export function normalizeIMessageHandle(_raw: string): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function parseIMessageTarget(_raw: string): IMessageTarget {
  throw new Error('Channel not available in Octopus slim build');
}

export function parseIMessageAllowTarget(_raw: string): IMessageAllowTarget {
  throw new Error('Channel not available in Octopus slim build');
}

export function isAllowedIMessageSender(_params: ChatSenderAllowParams): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function formatIMessageChatTarget(_chatId?: number | null): string {
  throw new Error('Channel not available in Octopus slim build');
}
