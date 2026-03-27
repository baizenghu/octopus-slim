// STUB: removed from Octopus slim build
import type { DirectoryConfigParams } from "../channels/plugins/directory-config.js";
import type { ChannelDirectoryEntry } from "../channels/plugins/types.js";

export async function listSlackDirectoryPeersLive(
  _params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  throw new Error('Channel not available in Octopus slim build');
}

export async function listSlackDirectoryGroupsLive(
  _params: DirectoryConfigParams,
): Promise<ChannelDirectoryEntry[]> {
  throw new Error('Channel not available in Octopus slim build');
}
