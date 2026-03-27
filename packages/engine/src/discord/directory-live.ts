// STUB: removed from Octopus slim build
import type { DirectoryConfigParams } from "../channels/plugins/directory-config.js";
import type { ChannelDirectoryEntry } from "../channels/plugins/types.js";

export async function listDiscordDirectoryGroupsLive(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  throw new Error("Channel not available in Octopus slim build");
}

export async function listDiscordDirectoryPeersLive(
  params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  throw new Error("Channel not available in Octopus slim build");
}
