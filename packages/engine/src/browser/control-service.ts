// STUB: removed from Octopus slim build

export type BrowserServerState = {
  port: number;
  stop: () => Promise<void>;
};

export function getBrowserControlState(): BrowserServerState | null {
  return null;
}

export function createBrowserControlContext(): unknown {
  return {};
}

export async function startBrowserControlServiceFromConfig(): Promise<BrowserServerState | null> {
  return null;
}

export async function stopBrowserControlService(): Promise<void> {}
