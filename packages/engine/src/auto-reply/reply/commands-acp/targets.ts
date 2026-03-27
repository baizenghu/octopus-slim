// STUB: removed from Octopus slim build
import type { HandleCommandsParams } from "../commands-types.js";

export function resolveBoundAcpThreadSessionKey(_params: HandleCommandsParams): string | undefined {
  return undefined;
}

export async function resolveAcpTargetSessionKey(_params: {
  commandParams: HandleCommandsParams;
  token?: string;
}): Promise<{ ok: true; sessionKey: string } | { ok: false; error: string }> {
  return { ok: false, error: "ACP is not available in Octopus slim build." };
}
