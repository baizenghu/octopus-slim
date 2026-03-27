// STUB: removed from Octopus slim build

export type NormalizedAllowFrom = {
  entries: string[];
  hasWildcard: boolean;
  hasEntries: boolean;
};

export const normalizeAllowFrom = (_list?: Array<string | number>): NormalizedAllowFrom => ({
  entries: [],
  hasWildcard: false,
  hasEntries: false,
});

export function isAllowed(_allowFrom: NormalizedAllowFrom, _id: string): boolean {
  return false;
}
