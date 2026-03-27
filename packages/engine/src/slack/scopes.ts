// STUB: removed from Octopus slim build

export type SlackScopesResult = {
  ok: boolean;
  scopes?: string[];
  source?: string;
  error?: string;
};

export async function fetchSlackScopes(
  _token: string,
  _timeoutMs: number,
): Promise<SlackScopesResult> {
  throw new Error('Channel not available in Octopus slim build');
}
