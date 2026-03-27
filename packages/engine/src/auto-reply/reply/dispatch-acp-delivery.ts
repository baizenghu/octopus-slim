// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../../config/config.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

export type AcpDispatchDeliveryMeta = {
  toolCallId?: string;
  allowEdit?: boolean;
};

export type AcpDispatchDeliveryCoordinator = {
  startReplyLifecycle: () => Promise<void>;
  deliver: (
    kind: ReplyDispatchKind,
    payload: ReplyPayload,
    meta?: AcpDispatchDeliveryMeta,
  ) => Promise<boolean>;
  getBlockCount: () => number;
  getAccumulatedBlockText: () => string;
  getRoutedCounts: () => Record<ReplyDispatchKind, number>;
  applyRoutedCounts: (counts: Record<ReplyDispatchKind, number>) => void;
};

export function createAcpDispatchDeliveryCoordinator(_params: {
  cfg: OctopusConfig;
  ctx: FinalizedMsgContext;
  dispatcher: ReplyDispatcher;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  shouldRouteToOriginating: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  onReplyStart?: () => Promise<void> | void;
}): AcpDispatchDeliveryCoordinator {
  throw new Error("ACP is not available in Octopus slim build");
}
