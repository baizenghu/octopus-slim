// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { DiscordAccountConfig } from "../config/types.discord.js";

export type DiscordCredentialStatus = "available" | "configured_unavailable" | "missing";

export type InspectedDiscordAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "config" | "none";
  tokenStatus: DiscordCredentialStatus;
  configured: boolean;
  config: DiscordAccountConfig;
};

export function inspectDiscordAccount(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
  envToken?: string | null;
}): InspectedDiscordAccount {
  throw new Error("Channel not available in Octopus slim build");
}
