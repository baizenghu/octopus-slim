// STUB: removed from Octopus slim build

import type { loadConfig } from "../config/config.js";
import type { IMessageService } from "./targets.js";
import type { ResolvedIMessageAccount } from "./accounts.js";

export type IMessageRpcClient = {
  request<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T>;
  stop(): Promise<void>;
};

export type IMessageSendOpts = {
  cliPath?: string;
  dbPath?: string;
  service?: IMessageService;
  region?: string;
  accountId?: string;
  replyToId?: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  chatId?: number;
  client?: IMessageRpcClient;
  config?: ReturnType<typeof loadConfig>;
  account?: ResolvedIMessageAccount;
  resolveAttachmentImpl?: (
    mediaUrl: string,
    maxBytes: number,
    options?: { localRoots?: readonly string[] },
  ) => Promise<{ path: string; contentType?: string }>;
  createClient?: (params: { cliPath: string; dbPath?: string }) => Promise<IMessageRpcClient>;
};

export type IMessageSendResult = {
  messageId: string;
};

export async function sendMessageIMessage(
  _to: string,
  _text: string,
  _opts: IMessageSendOpts = {},
): Promise<IMessageSendResult> {
  throw new Error('Channel not available in Octopus slim build');
}
