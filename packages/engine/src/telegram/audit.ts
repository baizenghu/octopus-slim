// STUB: removed from Octopus slim build
import type { TelegramGroupConfig } from "../config/types.js";

export type TelegramGroupMembershipAuditEntry = {
  chatId: string;
  ok: boolean;
  status?: string | null;
  error?: string | null;
  matchKey?: string;
  matchSource?: "id";
};

export type TelegramGroupMembershipAudit = {
  ok: boolean;
  checkedGroups: number;
  unresolvedGroups: number;
  hasWildcardUnmentionedGroups: boolean;
  groups: TelegramGroupMembershipAuditEntry[];
  elapsedMs: number;
};

export type AuditTelegramGroupMembershipParams = {
  token: string;
  botId: number;
  groupIds: string[];
  proxyUrl?: string;
  timeoutMs: number;
};

export function collectTelegramUnmentionedGroupIds(
  groups: Record<string, TelegramGroupConfig> | undefined,
): { groupIds: string[]; unresolvedGroups: number; hasWildcardUnmentionedGroups: boolean } {
  throw new Error('Channel not available in Octopus slim build');
}

export async function auditTelegramGroupMembership(
  params: AuditTelegramGroupMembershipParams,
): Promise<TelegramGroupMembershipAudit> {
  throw new Error('Channel not available in Octopus slim build');
}
