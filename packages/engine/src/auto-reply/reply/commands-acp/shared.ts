// STUB: removed from Octopus slim build
import type { AcpRuntimeSessionMode } from "../../../acp/runtime/types.js";
import type { AcpSessionRuntimeOptions } from "../../../config/sessions/types.js";
import type { CommandHandlerResult, HandleCommandsParams } from "../commands-types.js";
export { resolveAcpInstallCommandHint, resolveConfiguredAcpBackendId } from "./install-hints.js";
export { SESSION_ID_RE } from "../../../sessions/session-id.js";

export const COMMAND = "/acp";
export const ACP_SPAWN_USAGE =
  "Usage: /acp spawn [harness-id] [--mode persistent|oneshot] [--thread auto|here|off] [--cwd <path>] [--label <label>].";
export const ACP_STEER_USAGE =
  "Usage: /acp steer [--session <session-key|session-id|session-label>] <instruction>";
export const ACP_SET_MODE_USAGE =
  "Usage: /acp set-mode <mode> [session-key|session-id|session-label]";
export const ACP_SET_USAGE = "Usage: /acp set <key> <value> [session-key|session-id|session-label]";
export const ACP_CWD_USAGE = "Usage: /acp cwd <path> [session-key|session-id|session-label]";
export const ACP_PERMISSIONS_USAGE =
  "Usage: /acp permissions <profile> [session-key|session-id|session-label]";
export const ACP_TIMEOUT_USAGE =
  "Usage: /acp timeout <seconds> [session-key|session-id|session-label]";
export const ACP_MODEL_USAGE =
  "Usage: /acp model <model-id> [session-key|session-id|session-label]";
export const ACP_RESET_OPTIONS_USAGE =
  "Usage: /acp reset-options [session-key|session-id|session-label]";
export const ACP_STATUS_USAGE = "Usage: /acp status [session-key|session-id|session-label]";
export const ACP_INSTALL_USAGE = "Usage: /acp install";
export const ACP_DOCTOR_USAGE = "Usage: /acp doctor";
export const ACP_SESSIONS_USAGE = "Usage: /acp sessions";
export const ACP_STEER_OUTPUT_LIMIT = 800;

export type AcpAction =
  | "spawn"
  | "cancel"
  | "steer"
  | "close"
  | "sessions"
  | "status"
  | "set-mode"
  | "set"
  | "cwd"
  | "permissions"
  | "timeout"
  | "model"
  | "reset-options"
  | "doctor"
  | "install"
  | "help";

export type AcpSpawnThreadMode = "auto" | "here" | "off";

export type ParsedSpawnInput = {
  agentId: string;
  mode: AcpRuntimeSessionMode;
  thread: AcpSpawnThreadMode;
  cwd?: string;
  label?: string;
};

export type ParsedSteerInput = {
  sessionToken?: string;
  instruction: string;
};

export type ParsedSingleValueCommandInput = {
  value: string;
  sessionToken?: string;
};

export type ParsedSetCommandInput = {
  key: string;
  value: string;
  sessionToken?: string;
};

export function stopWithText(text: string): CommandHandlerResult {
  return { shouldContinue: false, reply: { text } };
}

export function resolveAcpAction(tokens: string[]): AcpAction {
  const action = tokens[0]?.trim().toLowerCase();
  if (
    action === "spawn" || action === "cancel" || action === "steer" || action === "close" ||
    action === "sessions" || action === "status" || action === "set-mode" || action === "set" ||
    action === "cwd" || action === "permissions" || action === "timeout" || action === "model" ||
    action === "reset-options" || action === "doctor" || action === "install" || action === "help"
  ) {
    tokens.shift();
    return action;
  }
  return "help";
}

export function parseSpawnInput(
  _params: HandleCommandsParams,
  _tokens: string[],
): { ok: false; error: string } {
  return { ok: false, error: "ACP is not available in Octopus slim build." };
}

export function parseSteerInput(
  _tokens: string[],
): { ok: false; error: string } {
  return { ok: false, error: "ACP is not available in Octopus slim build." };
}

export function parseSingleValueCommandInput(
  _tokens: string[],
  _usage: string,
): { ok: false; error: string } {
  return { ok: false, error: "ACP is not available in Octopus slim build." };
}

export function parseSetCommandInput(
  _tokens: string[],
): { ok: false; error: string } {
  return { ok: false, error: "ACP is not available in Octopus slim build." };
}

export function parseOptionalSingleTarget(
  _tokens: string[],
  _usage: string,
): { ok: true; sessionToken?: string } {
  return { ok: true };
}

export function resolveAcpHelpText(): string {
  return "ACP is not available in Octopus slim build.";
}

export function formatRuntimeOptionsText(_options: AcpSessionRuntimeOptions): string {
  return "(none)";
}

export function formatAcpCapabilitiesText(_controls: string[]): string {
  return "(none)";
}

export function resolveCommandRequestId(_params: HandleCommandsParams): string {
  return "";
}

export function collectAcpErrorText(_params: {
  error: unknown;
  fallbackCode: string;
  fallbackMessage: string;
}): string {
  return "ACP is not available in Octopus slim build.";
}

export async function withAcpCommandErrorBoundary<T>(_params: {
  run: () => Promise<T>;
  fallbackCode: string;
  fallbackMessage: string;
  onSuccess: (value: T) => CommandHandlerResult;
}): Promise<CommandHandlerResult> {
  return stopWithText("ACP is not available in Octopus slim build.");
}
