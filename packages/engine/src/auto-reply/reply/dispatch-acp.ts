// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../../config/config.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

type DispatchProcessedRecorder = (
  outcome: "completed" | "skipped" | "error",
  opts?: {
    reason?: string;
    error?: string;
  },
) => void;

export function shouldBypassAcpDispatchForCommand(
  _ctx: FinalizedMsgContext,
  _cfg: OctopusConfig,
): boolean {
  return false;
}

export type AcpDispatchAttemptResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

export async function tryDispatchAcpReply(_params: {
  ctx: FinalizedMsgContext;
  cfg: OctopusConfig;
  dispatcher: ReplyDispatcher;
  sessionKey?: string;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  shouldRouteToOriginating: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  shouldSendToolSummaries: boolean;
  bypassForCommand: boolean;
  onReplyStart?: () => Promise<void> | void;
  recordProcessed: DispatchProcessedRecorder;
  markIdle: (reason: string) => void;
}): Promise<AcpDispatchAttemptResult | null> {
  return null;
}
