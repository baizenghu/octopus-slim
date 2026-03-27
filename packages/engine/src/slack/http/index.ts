// STUB: removed from Octopus slim build
import type { IncomingMessage, ServerResponse } from "node:http";

export type SlackHttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export function normalizeSlackWebhookPath(_path?: string | null): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function registerSlackHttpHandler(_params: {
  path?: string | null;
  handler: SlackHttpRequestHandler;
  log?: (message: string) => void;
  accountId?: string;
}): () => void {
  throw new Error('Channel not available in Octopus slim build');
}

export async function handleSlackHttpRequest(
  _req: IncomingMessage,
  _res: ServerResponse,
): Promise<boolean> {
  throw new Error('Channel not available in Octopus slim build');
}
