// STUB: removed from Octopus slim build

import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OctopusConfig } from "../config/config.js";
import type { SignalAccountConfig } from "../config/types.js";

export type ResolvedSignalAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  baseUrl: string;
  configured: boolean;
  config: SignalAccountConfig;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("signal");
export const listSignalAccountIds = listAccountIds;
export const resolveDefaultSignalAccountId = resolveDefaultAccountId;

export function resolveSignalAccount(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): ResolvedSignalAccount {
  throw new Error('Channel not available in Octopus slim build');
}

export function listEnabledSignalAccounts(_cfg: OctopusConfig): ResolvedSignalAccount[] {
  throw new Error('Channel not available in Octopus slim build');
}
