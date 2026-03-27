// STUB: removed from Octopus slim build

import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OctopusConfig } from "../config/config.js";
import type { IMessageAccountConfig } from "../config/types.js";

export type ResolvedIMessageAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  config: IMessageAccountConfig;
  configured: boolean;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("imessage");
export const listIMessageAccountIds = listAccountIds;
export const resolveDefaultIMessageAccountId = resolveDefaultAccountId;

export function resolveIMessageAccount(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): ResolvedIMessageAccount {
  throw new Error('Channel not available in Octopus slim build');
}

export function listEnabledIMessageAccounts(_cfg: OctopusConfig): ResolvedIMessageAccount[] {
  throw new Error('Channel not available in Octopus slim build');
}
