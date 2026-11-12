/**
 * Turn off Zod's `new Function` fast path without importing Zod.
 *
 * Zod compiles a faster object parser with `new Function`, and finds out whether
 * it may by calling `new Function("")` inside a try/catch the first time any
 * object schema parses. The catch swallows the throw, but the browser has
 * already reported it: that probe was the `script-src` "eval" violation every
 * staff page sent to /api/csp-report.
 *
 * Calling `config({ jitless: true })` from `zod/v4/core` did this, but put Zod's
 * core module (about 5 KB gzip) on every route's first load for one flag. Zod
 * keeps its settings on `globalThis.__zod_globalConfig` and adopts an object
 * already there, so the flag is set on that object, created if Zod has not
 * loaded yet and mutated in place if it has. `zod-jitless.test.ts` fails if a
 * Zod upgrade renames the global.
 */
export function makeZodJitless(target: typeof globalThis = globalThis): void {
  const holder = target as { __zod_globalConfig?: { jitless?: boolean } };
  holder.__zod_globalConfig ??= {};
  holder.__zod_globalConfig.jitless = true;
}
