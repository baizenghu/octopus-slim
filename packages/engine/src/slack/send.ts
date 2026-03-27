// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { SlackTokenSource } from "./accounts.js";

export type SlackSendIdentity = {
  username?: string;
  iconUrl?: string;
  iconEmoji?: string;
};

export type SlackSendResult = {
  messageId: string;
  channelId: string;
};

type SlackSendOpts = {
  cfg?: OctopusConfig;
  token?: string;
  accountId?: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  threadTs?: string;
  identity?: SlackSendIdentity;
  blocks?: unknown[];
};

export async function sendMessageSlack(
  _to: string,
  _message: string,
  _opts: SlackSendOpts = {},
): Promise<SlackSendResult> {
  throw new Error('Channel not available in Octopus slim build');
}
