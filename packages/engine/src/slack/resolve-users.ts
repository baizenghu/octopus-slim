// STUB: removed from Octopus slim build

export type SlackUserLookup = {
  id: string;
  name: string;
  displayName?: string;
  realName?: string;
  email?: string;
  deleted: boolean;
  isBot: boolean;
  isAppUser: boolean;
};

export type SlackUserResolution = {
  input: string;
  resolved: boolean;
  id?: string;
  name?: string;
  email?: string;
  deleted?: boolean;
  isBot?: boolean;
  note?: string;
};

export async function resolveSlackUserAllowlist(_params: {
  token: string;
  entries: string[];
}): Promise<SlackUserResolution[]> {
  throw new Error('Channel not available in Octopus slim build');
}
