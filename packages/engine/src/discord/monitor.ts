// STUB: removed from Octopus slim build
import type { OctopusConfig, ReplyToMode } from "../config/config.js";

export type {
  DiscordAllowList,
  DiscordChannelConfigResolved,
  DiscordGuildEntryResolved,
} from "./monitor/allow-list.js";
export {
  allowListMatches,
  isDiscordGroupAllowedByPolicy,
  normalizeDiscordAllowList,
  normalizeDiscordSlug,
  resolveDiscordChannelConfig,
  resolveDiscordChannelConfigWithFallback,
  resolveDiscordCommandAuthorized,
  resolveDiscordGuildEntry,
  resolveDiscordShouldRequireMention,
  resolveGroupDmAllow,
  shouldEmitDiscordReactionNotification,
} from "./monitor/allow-list.js";

export type DiscordMessageEvent = unknown;
export type DiscordMessageHandler = (...args: unknown[]) => Promise<void>;

export function registerDiscordListener(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function createDiscordMessageHandler(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function buildDiscordMediaPayload(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function createDiscordNativeCommand(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export type MonitorDiscordOpts = {
  token?: string;
  accountId?: string;
  config?: OctopusConfig;
  runtime?: unknown;
  abortSignal?: AbortSignal;
  mediaMaxMb?: number;
  historyLimit?: number;
  replyToMode?: ReplyToMode;
  setStatus?: unknown;
};

export async function monitorDiscordProvider(opts: MonitorDiscordOpts = {}): Promise<void> {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordReplyTarget(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function sanitizeDiscordThreadName(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}
