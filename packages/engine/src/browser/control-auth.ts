// STUB: removed from Octopus slim build

export type BrowserControlAuth = {
  token?: string;
  password?: string;
  secret?: string;
  auth?: { token?: string; password?: string };
  [key: string]: unknown;
};

export function resolveBrowserControlAuth(..._args: unknown[]): BrowserControlAuth | null {
  return null;
}

export async function ensureBrowserControlAuth(_params: unknown): Promise<BrowserControlAuth> {
  throw new Error("Browser not available in Octopus slim build");
}
