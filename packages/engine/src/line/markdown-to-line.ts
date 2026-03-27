// STUB: removed from Octopus slim build

import type { messagingApi } from "@line/bot-sdk";

type FlexBubble = messagingApi.FlexBubble;
type FlexMessage = messagingApi.FlexMessage;

export interface ProcessedLineMessage {
  text: string;
  flexMessages: FlexMessage[];
}

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

export interface CodeBlock {
  language?: string;
  code: string;
}

export interface MarkdownLink {
  text: string;
  url: string;
}

export function extractMarkdownTables(_text: string): {
  tables: MarkdownTable[];
  textWithoutTables: string;
} {
  throw new Error('Channel not available in Octopus slim build');
}

export function convertTableToFlexBubble(_table: MarkdownTable): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function extractCodeBlocks(_text: string): {
  codeBlocks: CodeBlock[];
  textWithoutCode: string;
} {
  throw new Error('Channel not available in Octopus slim build');
}

export function convertCodeBlockToFlexBubble(_block: CodeBlock): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function extractLinks(_text: string): { links: MarkdownLink[]; textWithLinks: string } {
  throw new Error('Channel not available in Octopus slim build');
}

export function convertLinksToFlexBubble(_links: MarkdownLink[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function stripMarkdown(_text: string): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function processLineMessage(_text: string): ProcessedLineMessage {
  throw new Error('Channel not available in Octopus slim build');
}

export function hasMarkdownToConvert(_text: string): boolean {
  throw new Error('Channel not available in Octopus slim build');
}
