// STUB: removed from Octopus slim build
import { type RetryOptions, type WebClientOptions, WebClient } from "@slack/web-api";

export const SLACK_DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 2,
  factor: 2,
  minTimeout: 500,
  maxTimeout: 3000,
  randomize: true,
};

export function resolveSlackWebClientOptions(_options: WebClientOptions = {}): WebClientOptions {
  throw new Error('Channel not available in Octopus slim build');
}

export function createSlackWebClient(_token: string, _options: WebClientOptions = {}): WebClient {
  throw new Error('Channel not available in Octopus slim build');
}
