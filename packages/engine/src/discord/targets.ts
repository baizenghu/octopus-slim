// STUB: removed from Octopus slim build
import type { DirectoryConfigParams } from "../channels/plugins/directory-config.js";
import {
  buildMessagingTarget,
  parseMentionPrefixOrAtUserTarget,
  requireTargetKind,
  type MessagingTarget,
  type MessagingTargetKind,
  type MessagingTargetParseOptions,
} from "../channels/targets.js";

export type DiscordTargetKind = MessagingTargetKind;

export type DiscordTarget = MessagingTarget;

type DiscordTargetParseOptions = MessagingTargetParseOptions;

export function parseDiscordTarget(
  raw: string,
  options: DiscordTargetParseOptions = {},
): DiscordTarget | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordChannelId(raw: string): string {
  throw new Error("Channel not available in Octopus slim build");
}

export async function resolveDiscordTarget(
  raw: string,
  options: DirectoryConfigParams,
  parseOptions: DiscordTargetParseOptions = {},
): Promise<MessagingTarget | undefined> {
  throw new Error("Channel not available in Octopus slim build");
}
