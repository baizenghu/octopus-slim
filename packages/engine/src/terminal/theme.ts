// SLIM: removed — theme must be a real object because globals.ts destructures it at import time
const identity = (s: string) => s;
export const colorize: any = identity;
export const isRich: any = false;

// Recursive proxy so that both `theme.error(x)` and `theme.error.bold(x)` work
const makeThemeProxy = (): any =>
  new Proxy(identity, {
    get: () => makeThemeProxy(),
  });
export const theme: any = makeThemeProxy();
