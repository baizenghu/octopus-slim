// STUB: removed from Octopus slim build
import type {
  ChannelThreadingContext,
  ChannelThreadingToolContext,
} from "../channels/plugins/types.js";
import type { OctopusConfig } from "../config/config.js";

export function buildSlackThreadingToolContext(_params: {
  cfg: OctopusConfig;
  accountId?: string | null;
  context: ChannelThreadingContext;
  hasRepliedRef?: { value: boolean };
}): ChannelThreadingToolContext {
  throw new Error('Channel not available in Octopus slim build');
}
