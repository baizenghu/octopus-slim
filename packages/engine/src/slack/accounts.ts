// STUB: removed from Octopus slim build
import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OctopusConfig } from "../config/config.js";
import type { SlackAccountConfig } from "../config/types.js";
import type { SlackAccountSurfaceFields } from "./account-surface-fields.js";

export type SlackTokenSource = "env" | "config" | "none";

export type ResolvedSlackAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  botToken?: string;
  appToken?: string;
  userToken?: string;
  botTokenSource: SlackTokenSource;
  appTokenSource: SlackTokenSource;
  userTokenSource: SlackTokenSource;
  config: SlackAccountConfig;
} & SlackAccountSurfaceFields;

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("slack");
export const listSlackAccountIds = listAccountIds;
export const resolveDefaultSlackAccountId = resolveDefaultAccountId;

export function mergeSlackAccountConfig(
  _cfg: OctopusConfig,
  _accountId: string,
): SlackAccountConfig {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSlackAccount(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): ResolvedSlackAccount {
  throw new Error('Channel not available in Octopus slim build');
}

export function listEnabledSlackAccounts(_cfg: OctopusConfig): ResolvedSlackAccount[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSlackReplyToMode(
  _account: ResolvedSlackAccount,
  _chatType?: string | null,
): "off" | "first" | "all" {
  throw new Error('Channel not available in Octopus slim build');
}
