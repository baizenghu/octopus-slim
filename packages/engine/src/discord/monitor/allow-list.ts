// STUB: removed from Octopus slim build
import type { AllowlistMatch } from "../../channels/allowlist-match.js";
import type { ChannelMatchSource } from "../../channels/channel-config.js";

export type DiscordAllowList = {
  allowAll: boolean;
  ids: Set<string>;
  names: Set<string>;
};

export type DiscordAllowListMatch = AllowlistMatch<"wildcard" | "id" | "name" | "tag">;

export type DiscordGuildEntryResolved = {
  id?: string;
  slug?: string;
  requireMention?: boolean;
  ignoreOtherMentions?: boolean;
  reactionNotifications?: "off" | "own" | "all" | "allowlist";
  users?: string[];
  roles?: string[];
  channels?: Record<
    string,
    {
      allow?: boolean;
      requireMention?: boolean;
      ignoreOtherMentions?: boolean;
      skills?: string[];
      enabled?: boolean;
      users?: string[];
      roles?: string[];
      systemPrompt?: string;
      includeThreadStarter?: boolean;
      autoThread?: boolean;
    }
  >;
};

export type DiscordChannelConfigResolved = {
  allowed: boolean;
  requireMention?: boolean;
  ignoreOtherMentions?: boolean;
  skills?: string[];
  enabled?: boolean;
  users?: string[];
  roles?: string[];
  systemPrompt?: string;
  includeThreadStarter?: boolean;
  autoThread?: boolean;
  matchKey?: string;
  matchSource?: ChannelMatchSource;
};

export function normalizeDiscordAllowList(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function normalizeDiscordSlug(value: string): string {
  throw new Error("Channel not available in Octopus slim build");
}

export function allowListMatches(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordAllowListMatch(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordUserAllowed(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordRoleAllowed(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordMemberAllowed(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordMemberAccessState(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordOwnerAllowFrom(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordOwnerAccess(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordCommandAuthorized(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordGuildEntry(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordChannelConfig(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordChannelConfigWithFallback(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordShouldRequireMention(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function isDiscordAutoThreadOwnedByBot(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function isDiscordGroupAllowedByPolicy(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveGroupDmAllow(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function shouldEmitDiscordReactionNotification(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}
