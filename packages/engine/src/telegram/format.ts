// STUB: removed from Octopus slim build
import type { MarkdownTableMode } from "../config/types.base.js";

export type TelegramFormattedChunk = {
  html: string;
  text: string;
};

export function markdownToTelegramHtml(
  markdown: string,
  options: { tableMode?: MarkdownTableMode; wrapFileRefs?: boolean } = {},
): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function wrapFileReferencesInHtml(html: string): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function renderTelegramHtmlText(
  text: string,
  options: { textMode?: "markdown" | "html"; tableMode?: MarkdownTableMode } = {},
): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function markdownToTelegramChunks(
  markdown: string,
  limit: number,
  options: { tableMode?: MarkdownTableMode } = {},
): TelegramFormattedChunk[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function markdownToTelegramHtmlChunks(markdown: string, limit: number): string[] {
  throw new Error('Channel not available in Octopus slim build');
}
