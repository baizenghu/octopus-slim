// STUB: removed from Octopus slim build
import type { ChannelMessageActionName, ChannelToolSend } from "../channels/plugins/types.js";
import type { OctopusConfig } from "../config/config.js";

export function listSlackMessageActions(_cfg: OctopusConfig): ChannelMessageActionName[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function extractSlackToolSend(_args: Record<string, unknown>): ChannelToolSend | null {
  throw new Error('Channel not available in Octopus slim build');
}
