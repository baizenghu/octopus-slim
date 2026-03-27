// SLIM: removed — must return {text: input} because callers access .text on result
export function splitMediaFromOutput(raw: any): any { return { text: raw ?? '', mediaUrls: [] }; }
