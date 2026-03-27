// STUB: removed from Octopus slim build

export { probeSignal } from "./probe.js";
export { sendMessageSignal } from "./send.js";
export { sendReactionSignal, removeReactionSignal } from "./send-reactions.js";
export { resolveSignalReactionLevel } from "./reaction-level.js";

export function monitorSignalProvider(): never {
  throw new Error('Channel not available in Octopus slim build');
}
