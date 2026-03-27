// STUB: removed from Octopus slim build
import type {
  MessagingTarget,
  MessagingTargetKind,
} from "../channels/targets.js";

export type SlackTargetKind = MessagingTargetKind;

export type SlackTarget = MessagingTarget;

export function parseSlackTarget(
  _raw: string,
  _options: { defaultKind?: MessagingTargetKind } = {},
): SlackTarget | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSlackChannelId(_raw: string): string {
  throw new Error('Channel not available in Octopus slim build');
}
