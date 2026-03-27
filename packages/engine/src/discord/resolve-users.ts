// STUB: removed from Octopus slim build

export type DiscordUserResolution = {
  input: string;
  resolved: boolean;
  id?: string;
  name?: string;
  guildId?: string;
  guildName?: string;
  note?: string;
};

export async function resolveDiscordUserAllowlist(params: {
  token: string;
  entries: string[];
  fetcher?: typeof fetch;
}): Promise<DiscordUserResolution[]> {
  throw new Error("Channel not available in Octopus slim build");
}
