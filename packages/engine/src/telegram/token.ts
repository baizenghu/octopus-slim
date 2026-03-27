// STUB: removed from Octopus slim build
import type { BaseTokenResolution } from "../channels/plugins/types.js";
import type { OctopusConfig } from "../config/config.js";

export type TelegramTokenSource = "env" | "tokenFile" | "config" | "none";

export type TelegramTokenResolution = BaseTokenResolution & {
  source: TelegramTokenSource;
};

type ResolveTelegramTokenOpts = {
  envToken?: string | null;
  accountId?: string | null;
  logMissingFile?: (message: string) => void;
};

export function resolveTelegramToken(
  cfg?: OctopusConfig,
  opts: ResolveTelegramTokenOpts = {},
): TelegramTokenResolution {
  throw new Error('Channel not available in Octopus slim build');
}
