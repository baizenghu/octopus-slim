// Stub for CLI deps — channels were removed from engine.
// Provides no-op send functions and type definitions.
import type { OutboundSendDeps } from "../infra/outbound/deliver.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CliDeps = {
  sendMessageWhatsApp: (...args: any[]) => Promise<any>;
  sendMessageTelegram: (...args: any[]) => Promise<any>;
  sendMessageDiscord: (...args: any[]) => Promise<any>;
  sendMessageSlack: (...args: any[]) => Promise<any>;
  sendMessageSignal: (...args: any[]) => Promise<any>;
  sendMessageIMessage: (...args: any[]) => Promise<any>;
};

const notImplemented = async (): Promise<never> => {
  throw new Error("Channel send not available in engine package");
};

export function createDefaultDeps(): CliDeps {
  return {
    sendMessageWhatsApp: notImplemented,
    sendMessageTelegram: notImplemented,
    sendMessageDiscord: notImplemented,
    sendMessageSlack: notImplemented,
    sendMessageSignal: notImplemented,
    sendMessageIMessage: notImplemented,
  };
}

export function createOutboundSendDeps(_deps: CliDeps): OutboundSendDeps {
  return {};
}

export function logWebSelfId(): void {
  // No-op — web auth not available in engine package
}
