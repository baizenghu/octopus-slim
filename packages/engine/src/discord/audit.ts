// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";

export type DiscordChannelPermissionsAuditEntry = {
  channelId: string;
  ok: boolean;
  missing?: string[];
  error?: string | null;
  matchKey?: string;
  matchSource?: "id";
};

export type DiscordChannelPermissionsAudit = {
  ok: boolean;
  checkedChannels: number;
  unresolvedChannels: number;
  channels: DiscordChannelPermissionsAuditEntry[];
  elapsedMs: number;
};

export function collectDiscordAuditChannelIds(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): { channelIds: string[]; unresolvedChannels: number } {
  throw new Error("Channel not available in Octopus slim build");
}

export async function auditDiscordChannelPermissions(params: {
  token: string;
  accountId?: string | null;
  channelIds: string[];
  timeoutMs: number;
}): Promise<DiscordChannelPermissionsAudit> {
  throw new Error("Channel not available in Octopus slim build");
}
