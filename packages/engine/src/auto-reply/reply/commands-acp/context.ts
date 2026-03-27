// STUB: removed from Octopus slim build
import type { HandleCommandsParams } from "../commands-types.js";

export function resolveAcpCommandChannel(_params: HandleCommandsParams): string {
  return "";
}

export function resolveAcpCommandAccountId(_params: HandleCommandsParams): string {
  return "";
}

export function resolveAcpCommandThreadId(_params: HandleCommandsParams): string | undefined {
  return undefined;
}

export function resolveAcpCommandConversationId(_params: HandleCommandsParams): string | undefined {
  return undefined;
}

export function resolveAcpCommandParentConversationId(
  _params: HandleCommandsParams,
): string | undefined {
  return undefined;
}

export function isAcpCommandDiscordChannel(_params: HandleCommandsParams): boolean {
  return false;
}

export function resolveAcpCommandBindingContext(_params: HandleCommandsParams): {
  channel: string;
  accountId: string;
  threadId?: string | undefined;
  conversationId?: string | undefined;
  parentConversationId?: string | undefined;
} {
  return { channel: "", accountId: "" };
}
