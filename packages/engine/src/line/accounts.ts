// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { ResolvedLineAccount } from "./types.js";

export { DEFAULT_ACCOUNT_ID } from "../routing/account-id.js";

export function resolveLineAccount(_params: {
  cfg: OctopusConfig;
  accountId?: string;
}): ResolvedLineAccount {
  throw new Error('Channel not available in Octopus slim build');
}

export function listLineAccountIds(_cfg: OctopusConfig): string[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveDefaultLineAccountId(_cfg: OctopusConfig): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeAccountId(_accountId: string | undefined): string {
  throw new Error('Channel not available in Octopus slim build');
}
