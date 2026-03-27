// SLIM: removed
export type WizardPrompter = any;
export const WizardPrompter: any = {};
export class WizardCancelledError extends Error {
  constructor(..._args: any[]) { super('Wizard cancelled'); }
}
export type WizardSelectOption<T = any> = { value: T; label: string; hint?: string };
