// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { TelegramInlineButtonsScope } from "../config/types.telegram.js";

export function resolveTelegramInlineButtonsScope(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): TelegramInlineButtonsScope {
  throw new Error('Channel not available in Octopus slim build');
}

export function isTelegramInlineButtonsEnabled(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export { resolveTelegramTargetChatType } from "./targets.js";
