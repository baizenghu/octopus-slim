// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../../config/config.js";

export function resolveEffectiveResetTargetSessionKey(_params: {
  cfg: OctopusConfig;
  channel?: string | null;
  accountId?: string | null;
  conversationId?: string | null;
  parentConversationId?: string | null;
  activeSessionKey?: string | null;
  allowNonAcpBindingSessionKey?: boolean;
  skipConfiguredFallbackWhenActiveSessionNonAcp?: boolean;
  fallbackToActiveAcpWhenUnbound?: boolean;
}): string | undefined {
  return undefined;
}
