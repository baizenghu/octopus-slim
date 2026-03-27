// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type {
  ReactionLevel,
  ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "../utils/reaction-level.js";

export type TelegramReactionLevel = ReactionLevel;
export type ResolvedReactionLevel = BaseResolvedReactionLevel;

export function resolveTelegramReactionLevel(params: {
  cfg: OctopusConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  throw new Error('Channel not available in Octopus slim build');
}
