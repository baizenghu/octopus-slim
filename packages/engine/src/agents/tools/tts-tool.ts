// STUB: TTS removed from Octopus slim build
import { Type } from "@sinclair/typebox";
import type { OctopusConfig } from "../../config/config.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";

export function createTtsTool(_opts?: {
  config?: OctopusConfig;
  agentChannel?: GatewayMessageChannel;
}): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description: "TTS is not available in Octopus slim build",
    parameters: Type.Object({}),
    execute: async () => {
      throw new Error("TTS is not available in Octopus slim build");
    },
  };
}
