// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { SignalTextStyleRange } from "./format.js";

export type SignalSendOpts = {
  cfg?: OctopusConfig;
  baseUrl?: string;
  account?: string;
  accountId?: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  textMode?: "markdown" | "plain";
  textStyles?: SignalTextStyleRange[];
};

export type SignalSendResult = {
  messageId: string;
  timestamp?: number;
};

export type SignalRpcOpts = Pick<SignalSendOpts, "baseUrl" | "account" | "accountId" | "timeoutMs">;

export type SignalReceiptType = "read" | "viewed";

export async function sendMessageSignal(
  _to: string,
  _text: string,
  _opts: SignalSendOpts = {},
): Promise<SignalSendResult> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function sendTypingSignal(
  _to: string,
  _opts: SignalRpcOpts & { stop?: boolean } = {},
): Promise<boolean> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function sendReadReceiptSignal(
  _to: string,
  _targetTimestamp: number,
  _opts: SignalRpcOpts & { type?: SignalReceiptType } = {},
): Promise<boolean> {
  throw new Error('Channel not available in Octopus slim build');
}
