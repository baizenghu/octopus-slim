// STUB: removed from Octopus slim build
import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OctopusConfig } from "../config/config.js";
import type { DiscordAccountConfig, DiscordActionConfig } from "../config/types.js";

export type ResolvedDiscordAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "config" | "none";
  config: DiscordAccountConfig;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("discord");
export const listDiscordAccountIds = listAccountIds;
export const resolveDefaultDiscordAccountId = resolveDefaultAccountId;

export function resolveDiscordAccountConfig(
  cfg: OctopusConfig,
  accountId: string,
): DiscordAccountConfig | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function mergeDiscordAccountConfig(
  cfg: OctopusConfig,
  accountId: string,
): DiscordAccountConfig {
  throw new Error("Channel not available in Octopus slim build");
}

export function createDiscordActionGate(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): (key: keyof DiscordActionConfig, defaultValue?: boolean) => boolean {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordAccount(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): ResolvedDiscordAccount {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordMaxLinesPerMessage(params: {
  cfg: OctopusConfig;
  discordConfig?: DiscordAccountConfig | null;
  accountId?: string | null;
}): number | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function listEnabledDiscordAccounts(cfg: OctopusConfig): ResolvedDiscordAccount[] {
  throw new Error("Channel not available in Octopus slim build");
}
