// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";

export const ACP_SPAWN_MODES = ["run", "session"] as const;
export type SpawnAcpMode = (typeof ACP_SPAWN_MODES)[number];
export const ACP_SPAWN_SANDBOX_MODES = ["inherit", "require"] as const;
export type SpawnAcpSandboxMode = (typeof ACP_SPAWN_SANDBOX_MODES)[number];
export const ACP_SPAWN_STREAM_TARGETS = ["parent"] as const;
export type SpawnAcpStreamTarget = (typeof ACP_SPAWN_STREAM_TARGETS)[number];

export type SpawnAcpParams = {
  task: string;
  label?: string;
  agentId?: string;
  cwd?: string;
  mode?: SpawnAcpMode;
  thread?: boolean;
  sandbox?: SpawnAcpSandboxMode;
  streamTo?: SpawnAcpStreamTarget;
};

export type SpawnAcpContext = {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  sandboxed?: boolean;
};

export type SpawnAcpResult = {
  status: "accepted" | "forbidden" | "error";
  childSessionKey?: string;
  runId?: string;
  mode?: SpawnAcpMode;
  streamLogPath?: string;
  note?: string;
  error?: string;
};

export const ACP_SPAWN_ACCEPTED_NOTE =
  "initial ACP task queued in isolated session; follow-ups continue in the bound thread.";
export const ACP_SPAWN_SESSION_ACCEPTED_NOTE =
  "thread-bound ACP session stays active after this task; continue in-thread for follow-ups.";

export function resolveAcpSpawnRuntimePolicyError(_params: {
  cfg: OctopusConfig;
  requesterSessionKey?: string;
  requesterSandboxed?: boolean;
  sandbox?: SpawnAcpSandboxMode;
}): string | undefined {
  return undefined;
}

export async function spawnAcpDirect(
  _params: SpawnAcpParams,
  _ctx: SpawnAcpContext,
): Promise<SpawnAcpResult> {
  throw new Error("ACP is not available in Octopus slim build");
}
