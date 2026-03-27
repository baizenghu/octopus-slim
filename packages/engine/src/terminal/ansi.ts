// SLIM: removed — string identity functions (callers use return values)
export function stripAnsi(s: any): any { return typeof s === 'string' ? s : String(s ?? ''); }
export function sanitizeForLog(s: any): any { return typeof s === 'string' ? s : String(s ?? ''); }
export function visibleWidth(s: any): any { return typeof s === 'string' ? s.length : 0; }
