// STUB: removed from Octopus slim build
import type { LineSendResult } from "./types.js";

export async function sendMessageLine(_to: string, _text: string, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushMessageLine(_to: string, _text: string, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function replyMessageLine(_replyToken: string, _messages: unknown[], _opts?: unknown): Promise<void> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushMessagesLine(_to: string, _messages: unknown[], _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushFlexMessage(_to: string, _altText: string, _contents: unknown, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushLocationMessage(_to: string, _location: unknown, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushTemplateMessage(_to: string, _altText: string, _template: unknown, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export async function pushTextMessageWithQuickReplies(_to: string, _text: string, _labels: string[], _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}

export function createQuickReplyItems(_labels: string[]): { items: unknown[] } {
  return { items: [] };
}

export function createFlexMessage(_altText: string, _contents: unknown): unknown {
  return {};
}

export function createImageMessage(_url: string, _previewUrl?: string): unknown {
  return {};
}

export function createLocationMessage(_location: unknown): unknown {
  return {};
}

export function createTextMessageWithQuickReplies(_text: string, _labels: string[]): unknown {
  return {};
}

export async function showLoadingAnimation(_chatId: string, _opts?: unknown): Promise<void> {}

export async function getUserProfile(_userId: string, _opts?: unknown): Promise<null> {
  return null;
}

export async function getUserDisplayName(_userId: string, _opts?: unknown): Promise<string> {
  return _userId;
}

export async function pushImageMessage(_to: string, _url: string, _opts?: unknown): Promise<LineSendResult> {
  throw new Error("LINE channel not available in Octopus slim build");
}
