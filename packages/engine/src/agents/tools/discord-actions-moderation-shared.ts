// STUB: Discord channel removed from Octopus slim build

export type DiscordModerationAction = "timeout" | "kick" | "ban";

export type DiscordModerationCommand = {
  action: DiscordModerationAction;
  guildId: string;
  userId: string;
  durationMinutes?: number;
  until?: string;
  reason?: string;
  deleteMessageDays?: number;
};

export function isDiscordModerationAction(action: string): action is DiscordModerationAction {
  return action === "timeout" || action === "kick" || action === "ban";
}

export function requiredGuildPermissionForModerationAction(
  _action: DiscordModerationAction,
): bigint {
  return 0n;
}

export function readDiscordModerationCommand(
  action: string,
  _params: Record<string, unknown>,
): DiscordModerationCommand {
  if (!isDiscordModerationAction(action)) {
    throw new Error(`Unsupported Discord moderation action: ${action}`);
  }
  return { action, guildId: "", userId: "" };
}
