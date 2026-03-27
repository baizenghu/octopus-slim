// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { TelegramAccountConfig } from "../config/types.telegram.js";

export type TelegramCredentialStatus = "available" | "configured_unavailable" | "missing";

export type InspectedTelegramAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  tokenStatus: TelegramCredentialStatus;
  configured: boolean;
  config: TelegramAccountConfig;
};

export function inspectTelegramAccount(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
  envToken?: string | null;
}): InspectedTelegramAccount {
  throw new Error('Channel not available in Octopus slim build');
}
