// STUB: removed from Octopus slim build

export type BrowserDispatchRequest = {
  method: string;
  path: string;
  body?: unknown;
  query?: unknown;
  [key: string]: unknown;
};

export type BrowserDispatchResponse = {
  status: number;
  body: unknown;
};

export type BrowserRouteDispatcher = {
  dispatch: (_req: BrowserDispatchRequest) => Promise<BrowserDispatchResponse>;
};

export function createBrowserRouteDispatcher(_ctx: unknown): BrowserRouteDispatcher {
  return {
    dispatch: async (_req) => {
      throw new Error("Browser not available in Octopus slim build");
    },
  };
}
