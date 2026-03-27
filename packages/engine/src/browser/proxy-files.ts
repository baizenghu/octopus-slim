// STUB: removed from Octopus slim build

export type BrowserProxyFile = {
  path: string;
  base64: string;
};

export async function persistBrowserProxyFiles(_files: BrowserProxyFile[] | undefined): Promise<Map<string, string>> {
  return new Map();
}

export function applyBrowserProxyPaths(_result: unknown, _mapping: Map<string, string>): void {}
