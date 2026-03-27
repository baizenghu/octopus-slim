// STUB: removed from Octopus slim build

export type SlackChannelLookup = {
  id: string;
  name: string;
  archived: boolean;
  isPrivate: boolean;
};

export type SlackChannelResolution = {
  input: string;
  resolved: boolean;
  id?: string;
  name?: string;
  archived?: boolean;
};

export async function resolveSlackChannelAllowlist(_params: {
  token: string;
  entries: string[];
}): Promise<SlackChannelResolution[]> {
  throw new Error('Channel not available in Octopus slim build');
}
