// STUB: removed from Octopus slim build
import type { AcpSessionUpdateTag } from "../../acp/runtime/types.js";
import type { OctopusConfig } from "../../config/config.js";

export const ACP_TAG_VISIBILITY_DEFAULTS: Record<AcpSessionUpdateTag, boolean> = {
  agent_message_chunk: true,
  tool_call: false,
  tool_call_update: false,
  usage_update: false,
  available_commands_update: false,
  current_mode_update: false,
  config_option_update: false,
  session_info_update: false,
  plan: false,
  agent_thought_chunk: false,
};

export type AcpDeliveryMode = "live" | "final_only";
export type AcpHiddenBoundarySeparator = "none" | "space" | "newline" | "paragraph";

export type AcpProjectionSettings = {
  deliveryMode: AcpDeliveryMode;
  hiddenBoundarySeparator: AcpHiddenBoundarySeparator;
  repeatSuppression: boolean;
  maxOutputChars: number;
  maxSessionUpdateChars: number;
  tagVisibility: Partial<Record<AcpSessionUpdateTag, boolean>>;
};

export function resolveAcpProjectionSettings(_cfg: OctopusConfig): AcpProjectionSettings {
  return {
    deliveryMode: "final_only",
    hiddenBoundarySeparator: "paragraph",
    repeatSuppression: true,
    maxOutputChars: 24_000,
    maxSessionUpdateChars: 320,
    tagVisibility: {},
  };
}

export function resolveAcpStreamingConfig(_params: {
  cfg: OctopusConfig;
  provider?: string;
  accountId?: string;
  deliveryMode?: AcpDeliveryMode;
}) {
  return {
    chunking: { minChars: 1, maxChars: 1800, flushOnParagraph: false, breakPreference: "paragraph" as const },
    coalescing: { minChars: 1, maxChars: 1800, idleMs: 350, joiner: "", flushOnEnqueue: false },
  };
}

export function isAcpTagVisible(
  _settings: AcpProjectionSettings,
  _tag: AcpSessionUpdateTag | undefined,
): boolean {
  return true;
}
