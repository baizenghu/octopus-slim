// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { ReactionLevel, ResolvedReactionLevel } from "../utils/reaction-level.js";

export type SignalReactionLevel = ReactionLevel;
export type ResolvedSignalReactionLevel = ResolvedReactionLevel;

export function resolveSignalReactionLevel(_params: {
  cfg: OctopusConfig;
  accountId?: string;
}): ResolvedSignalReactionLevel {
  throw new Error('Channel not available in Octopus slim build');
}
