// Stub — canvas-host was removed in engine-slim; only exports consumed by gateway remain.

import type { IncomingMessage, ServerResponse } from "node:http";

export const CANVAS_HOST_PATH = "/canvas";
export const A2UI_PATH = "/a2ui";
export const CANVAS_WS_PATH = "/canvas/ws";

export async function handleA2uiHttpRequest(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  res.statusCode = 404;
  res.end("Not Found");
  return false;
}
