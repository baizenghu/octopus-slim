// STUB: removed from Octopus slim build
import type { CommandHandlerResult, HandleCommandsParams } from "../commands-types.js";

const STUB_RESULT: CommandHandlerResult = {
  shouldContinue: false,
  reply: { text: "ACP is not available in Octopus slim build." },
};

export async function handleAcpStatusAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpSetModeAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpSetAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpCwdAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpPermissionsAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpTimeoutAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpModelAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}

export async function handleAcpResetOptionsAction(
  _params: HandleCommandsParams,
  _tokens: string[],
): Promise<CommandHandlerResult> {
  return STUB_RESULT;
}
