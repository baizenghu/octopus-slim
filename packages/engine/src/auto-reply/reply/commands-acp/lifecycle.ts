// STUB: removed from Octopus slim build
import type { CommandHandlerResult, HandleCommandsParams } from "../commands-types.js";

export async function handleAcpSpawnAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}

export async function handleAcpCancelAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}

export async function handleAcpSteerAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}

export async function handleAcpCloseAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return { shouldContinue: false, reply: { text: "ACP is not available in Octopus slim build." } };
}
