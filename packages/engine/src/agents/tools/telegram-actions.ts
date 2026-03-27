// STUB: Telegram channel removed from Octopus slim build
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { OctopusConfig } from "../../config/config.js";
import type { TelegramInlineButtons } from "../../telegram/button-types.js";

export function readTelegramButtons(
  _params: Record<string, unknown>,
): TelegramInlineButtons | undefined {
  return undefined;
}

export async function handleTelegramAction(
  _params: Record<string, unknown>,
  _cfg: OctopusConfig,
  _options?: {
    mediaLocalRoots?: readonly string[];
  },
): Promise<AgentToolResult<unknown>> {
  throw new Error("Telegram is not available in Octopus slim build");
}
