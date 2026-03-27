// STUB: removed from Octopus slim build
import type { AcpRuntimeEvent, AcpSessionUpdateTag } from "../../acp/runtime/types.js";
import type { OctopusConfig } from "../../config/config.js";
import type { ReplyPayload } from "../types.js";
import type { ReplyDispatchKind } from "./reply-dispatcher.js";

export type AcpProjectedDeliveryMeta = {
  tag?: AcpSessionUpdateTag;
  toolCallId?: string;
  toolStatus?: string;
  allowEdit?: boolean;
};

export type AcpReplyProjector = {
  onEvent: (event: AcpRuntimeEvent) => Promise<void>;
  flush: (force?: boolean) => Promise<void>;
};

export function createAcpReplyProjector(_params: {
  cfg: OctopusConfig;
  shouldSendToolSummaries: boolean;
  deliver: (
    kind: ReplyDispatchKind,
    payload: ReplyPayload,
    meta?: AcpProjectedDeliveryMeta,
  ) => Promise<boolean>;
  provider?: string;
  accountId?: string;
}): AcpReplyProjector {
  throw new Error("ACP is not available in Octopus slim build");
}
