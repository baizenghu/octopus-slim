// STUB: removed from Octopus slim build
import type { MsgContext } from "../auto-reply/templating.js";

export function normalizeExplicitDiscordSessionKey(
  sessionKey: string,
  ctx: Pick<MsgContext, "ChatType" | "From" | "SenderId">,
): string {
  throw new Error("Channel not available in Octopus slim build");
}
