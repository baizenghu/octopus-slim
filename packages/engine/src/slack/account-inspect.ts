// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { SlackAccountConfig } from "../config/types.slack.js";
import type { SlackAccountSurfaceFields } from "./account-surface-fields.js";
import type { SlackTokenSource } from "./accounts.js";

export type SlackCredentialStatus = "available" | "configured_unavailable" | "missing";

export type InspectedSlackAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  mode?: SlackAccountConfig["mode"];
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  userToken?: string;
  botTokenSource: SlackTokenSource;
  appTokenSource: SlackTokenSource;
  signingSecretSource?: SlackTokenSource;
  userTokenSource: SlackTokenSource;
  botTokenStatus: SlackCredentialStatus;
  appTokenStatus: SlackCredentialStatus;
  signingSecretStatus?: SlackCredentialStatus;
  userTokenStatus: SlackCredentialStatus;
  configured: boolean;
  config: SlackAccountConfig;
} & SlackAccountSurfaceFields;

export function inspectSlackAccount(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
  envBotToken?: string | null;
  envAppToken?: string | null;
  envUserToken?: string | null;
}): InspectedSlackAccount {
  throw new Error('Channel not available in Octopus slim build');
}
