// STUB: removed from Octopus slim build
import type { CommandHandlerResult, HandleCommandsParams } from "../commands-types.js";

export async function handleAcpDoctorAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}

export function handleAcpInstallAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): CommandHandlerResult {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}

export async function handleAcpSessionsAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}
