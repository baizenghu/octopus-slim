// STUB: Slack channel removed from Octopus slim build
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { OctopusConfig } from "../../config/config.js";

export type SlackActionContext = {
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
  mediaLocalRoots?: readonly string[];
};

export async function handleSlackAction(
  _params: Record<string, unknown>,
  _cfg: OctopusConfig,
  _context?: SlackActionContext,
): Promise<AgentToolResult<unknown>> {
  throw new Error("Slack is not available in Octopus slim build");
}
