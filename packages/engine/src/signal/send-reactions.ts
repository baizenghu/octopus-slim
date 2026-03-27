// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";

export type SignalReactionOpts = {
  cfg?: OctopusConfig;
  baseUrl?: string;
  account?: string;
  accountId?: string;
  timeoutMs?: number;
  targetAuthor?: string;
  targetAuthorUuid?: string;
  groupId?: string;
};

export type SignalReactionResult = {
  ok: boolean;
  timestamp?: number;
};

export async function sendReactionSignal(
  _recipient: string,
  _targetTimestamp: number,
  _emoji: string,
  _opts: SignalReactionOpts = {},
): Promise<SignalReactionResult> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function removeReactionSignal(
  _recipient: string,
  _targetTimestamp: number,
  _emoji: string,
  _opts: SignalReactionOpts = {},
): Promise<SignalReactionResult> {
  throw new Error('Channel not available in Octopus slim build');
}
