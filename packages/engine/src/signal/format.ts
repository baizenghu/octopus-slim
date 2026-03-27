// STUB: removed from Octopus slim build

import type { MarkdownTableMode } from "../config/types.base.js";

export type SignalTextStyleRange = {
  start: number;
  length: number;
  style: "BOLD" | "ITALIC" | "STRIKETHROUGH" | "MONOSPACE" | "SPOILER";
};

export type SignalFormattedText = {
  text: string;
  styles: SignalTextStyleRange[];
};

type SignalMarkdownOptions = {
  tableMode?: MarkdownTableMode;
};

export function markdownToSignalText(
  _markdown: string,
  _options: SignalMarkdownOptions = {},
): SignalFormattedText {
  throw new Error('Channel not available in Octopus slim build');
}

export function markdownToSignalTextChunks(
  _markdown: string,
  _limit: number,
  _options: SignalMarkdownOptions = {},
): SignalFormattedText[] {
  throw new Error('Channel not available in Octopus slim build');
}
