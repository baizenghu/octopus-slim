// STUB: Canvas tool removed from Octopus slim build
import { Type } from "@sinclair/typebox";
import type { OctopusConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";

export function createCanvasTool(_options?: { config?: OctopusConfig }): AnyAgentTool {
  return {
    label: "Canvas",
    name: "canvas",
    description: "Canvas is not available in Octopus slim build",
    parameters: Type.Object({}),
    execute: async () => {
      throw new Error("Canvas is not available in Octopus slim build");
    },
  };
}
