// STUB: Discord channel removed from Octopus slim build
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { DiscordActionConfig } from "../../config/config.js";
import type { ActionGate } from "./common.js";

export async function handleDiscordModerationAction(
  _action: string,
  _params: Record<string, unknown>,
  _isActionEnabled: ActionGate<DiscordActionConfig>,
): Promise<AgentToolResult<unknown>> {
  throw new Error("Discord is not available in Octopus slim build");
}
