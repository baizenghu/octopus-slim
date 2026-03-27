// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { TelegramAccountConfig, TelegramActionConfig } from "../config/types.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

export type ResolvedTelegramAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  config: TelegramAccountConfig;
};

export type TelegramPollActionGateState = {
  sendMessageEnabled: boolean;
  pollEnabled: boolean;
  enabled: boolean;
};

export function listTelegramAccountIds(cfg: OctopusConfig): string[] {
  throw new Error('Channel not available in Octopus slim build');
}

/** @internal Reset the once-per-process warning flag. Exported for tests only. */
export function resetMissingDefaultWarnFlag(): void {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveDefaultTelegramAccountId(cfg: OctopusConfig): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramAccountConfig(
  cfg: OctopusConfig,
  accountId: string,
): TelegramAccountConfig | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function mergeTelegramAccountConfig(
  cfg: OctopusConfig,
  accountId: string,
): TelegramAccountConfig {
  throw new Error('Channel not available in Octopus slim build');
}

export function createTelegramActionGate(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): (key: keyof TelegramActionConfig, defaultValue?: boolean) => boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramPollActionGateState(
  isActionEnabled: (key: keyof TelegramActionConfig, defaultValue?: boolean) => boolean,
): TelegramPollActionGateState {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveTelegramAccount(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): ResolvedTelegramAccount {
  throw new Error('Channel not available in Octopus slim build');
}

export function listEnabledTelegramAccounts(cfg: OctopusConfig): ResolvedTelegramAccount[] {
  throw new Error('Channel not available in Octopus slim build');
}
