// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { LineGroupConfig } from "./types.js";

export function resolveLineGroupLookupIds(_groupId?: string | null): string[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveLineGroupConfigEntry<T>(
  _groups: Record<string, T | undefined> | undefined,
  _params: { groupId?: string | null; roomId?: string | null },
): T | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveLineGroupsConfig(
  _cfg: OctopusConfig,
  _accountId?: string | null,
): Record<string, LineGroupConfig | undefined> | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveExactLineGroupConfigKey(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
  groupId?: string | null;
}): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveLineGroupHistoryKey(_params: {
  groupId?: string | null;
  roomId?: string | null;
}): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}
