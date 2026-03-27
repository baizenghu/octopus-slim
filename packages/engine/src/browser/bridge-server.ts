// STUB: removed from Octopus slim build
import type { Server } from "node:http";

export type BrowserBridge = {
  url?: string;
  baseUrl?: string;
  server?: Server;
  state?: {
    resolved?: unknown;
    [key: string]: unknown;
  };
  cdpPort?: number;
  stop?: () => Promise<void>;
};

export async function startBrowserBridgeServer(_params: unknown): Promise<BrowserBridge> {
  throw new Error("Browser not available in Octopus slim build");
}

export async function stopBrowserBridgeServer(_server: Server | BrowserBridge): Promise<void> {}
