// STUB: Discord channel removed from Octopus slim build
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { OctopusConfig } from "../../config/config.js";

export async function handleDiscordAction(
  _params: Record<string, unknown>,
  _cfg: OctopusConfig,
  _options?: {
    mediaLocalRoots?: readonly string[];
  },
): Promise<AgentToolResult<unknown>> {
  throw new Error("Discord is not available in Octopus slim build");
}
