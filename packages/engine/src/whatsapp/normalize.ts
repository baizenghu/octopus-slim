// STUB: removed from Octopus slim build

const WHATSAPP_USER_JID_RE = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/i;
const WHATSAPP_LID_RE = /^(\d+)@lid$/i;

export function isWhatsAppGroupJid(_value: string): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function isWhatsAppUserTarget(_value: string): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeWhatsAppTarget(_value: string): string | null {
  throw new Error('Channel not available in Octopus slim build');
}
