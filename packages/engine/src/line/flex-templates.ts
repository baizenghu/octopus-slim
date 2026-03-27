// STUB: removed from Octopus slim build

export type {
  Action,
  CardAction,
  FlexBox,
  FlexBubble,
  FlexButton,
  FlexCarousel,
  FlexComponent,
  FlexContainer,
  FlexImage,
  FlexText,
  ListItem,
} from "./flex-templates/types.js";

import type { FlexBubble, FlexCarousel } from "./flex-templates/types.js";
import type { messagingApi } from "@line/bot-sdk";

type FlexMessage = messagingApi.FlexMessage;

export function createActionCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createCarousel(..._args: unknown[]): FlexCarousel {
  throw new Error('Channel not available in Octopus slim build');
}

export function createImageCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createInfoCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createListCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createNotificationBubble(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createAgendaCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createEventCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createReceiptCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createAppleTvRemoteCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createDeviceControlCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function createMediaPlayerCard(..._args: unknown[]): FlexBubble {
  throw new Error('Channel not available in Octopus slim build');
}

export function toFlexMessage(..._args: unknown[]): FlexMessage {
  throw new Error('Channel not available in Octopus slim build');
}
