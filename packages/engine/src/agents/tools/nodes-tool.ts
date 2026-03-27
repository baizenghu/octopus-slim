// STUB: Nodes tool removed from Octopus slim build
import { Type } from "@sinclair/typebox";
import type { OctopusConfig } from "../../config/config.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";

export function createNodesTool(_options?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  currentChannelId?: string;
  currentThreadTs?: string | number;
  config?: OctopusConfig;
  modelHasVision?: boolean;
  allowMediaInvokeCommands?: boolean;
}): AnyAgentTool {
  return {
    label: "Nodes",
    name: "nodes",
    description: "Nodes is not available in Octopus slim build",
    parameters: Type.Object({}),
    execute: async () => {
      throw new Error("Nodes is not available in Octopus slim build");
    },
  };
}
