// STUB: removed from Octopus slim build

export type ButtonRow = Array<{ text: string; callback_data: string }>;

export type ParsedModelCallback =
  | { type: "providers" }
  | { type: "list"; provider: string; page: number }
  | { type: "select"; provider?: string; model: string }
  | { type: "back" };

export type ProviderInfo = {
  id: string;
  count: number;
};

export type ResolveModelSelectionResult =
  | { kind: "resolved"; provider: string; model: string }
  | { kind: "ambiguous"; model: string; matchingProviders: string[] };

export type ModelsKeyboardParams = {
  provider: string;
  models: readonly string[];
  currentModel?: string;
  currentPage: number;
  totalPages: number;
  pageSize?: number;
};

export function parseModelCallbackData(data: string): ParsedModelCallback | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildModelSelectionCallbackData(params: {
  provider: string;
  model: string;
}): string | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveModelSelection(params: {
  callback: Extract<ParsedModelCallback, { type: "select" }>;
  providers: readonly string[];
  byProvider: ReadonlyMap<string, ReadonlySet<string>>;
}): ResolveModelSelectionResult {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildProviderKeyboard(providers: ProviderInfo[]): ButtonRow[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildModelsKeyboard(params: ModelsKeyboardParams): ButtonRow[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function buildBrowseProvidersButton(): ButtonRow[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function getModelsPageSize(): number {
  throw new Error('Channel not available in Octopus slim build');
}

export function calculateTotalPages(totalModels: number, pageSize?: number): number {
  throw new Error('Channel not available in Octopus slim build');
}
