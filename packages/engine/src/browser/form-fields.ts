// STUB: removed from Octopus slim build
import type { BrowserFormField } from "./client-actions-core.js";

export const DEFAULT_FILL_FIELD_TYPE = "text";

export function normalizeBrowserFormFieldRef(_value: unknown): string {
  return String(_value ?? "");
}

export function normalizeBrowserFormFieldType(_value: unknown): string {
  return String(_value ?? DEFAULT_FILL_FIELD_TYPE);
}

export function normalizeBrowserFormFieldValue(_value: unknown): BrowserFormField["value"] | undefined {
  return undefined;
}

export function normalizeBrowserFormField(_field: unknown): BrowserFormField {
  return {};
}
