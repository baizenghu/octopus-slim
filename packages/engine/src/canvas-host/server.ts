// Stub — canvas-host was removed in engine-slim; only types/factories consumed by gateway remain.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { RuntimeEnv } from "../runtime.js";

export interface CanvasHostHandler {
  rootDir: string | null;
  basePath: string;
  close: () => Promise<void>;
  handleUpgrade: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => boolean;
  handleHttpRequest: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

export interface CanvasHostServer {
  port: number | null;
  close: () => Promise<void>;
}

export async function createCanvasHostHandler(_opts: {
  runtime: RuntimeEnv;
  rootDir?: string;
  basePath?: string;
  allowInTests?: boolean;
  liveReload?: boolean;
}): Promise<CanvasHostHandler> {
  return {
    rootDir: null,
    basePath: "/canvas",
    close: async () => {},
    handleUpgrade: () => false,
    handleHttpRequest: async () => false,
  };
}
