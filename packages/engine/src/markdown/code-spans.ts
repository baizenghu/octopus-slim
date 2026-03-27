// SLIM: removed — callers access .inlineState and .spans on result
export type InlineCodeState = any;
export function buildCodeSpanIndex(..._args: any[]): any { return { spans: [], inlineState: _args[1] ?? {} }; }
export function createInlineCodeState(): any { return { inBacktick: false, count: 0 }; }
