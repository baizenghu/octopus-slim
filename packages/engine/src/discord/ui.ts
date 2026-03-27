// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import { Container } from "@buape/carbon";

export function normalizeDiscordAccentColor(raw?: string | null): string | null {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordAccentColor(params: {
  cfg: OctopusConfig;
  accountId?: string | null;
}): string {
  throw new Error("Channel not available in Octopus slim build");
}

export class DiscordUiContainer extends Container {
  constructor(_params: {
    cfg: OctopusConfig;
    accountId?: string | null;
    components?: unknown;
    accentColor?: string;
    spoiler?: boolean;
  }) {
    super([]);
    throw new Error("Channel not available in Octopus slim build");
  }
}
