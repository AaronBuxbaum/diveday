import type { BrowserContext } from "@playwright/test";

/**
 * The cookie the browser clock follows when a spec has moved the server's
 * clock (the `clock` fixture, `e2e/fixtures.ts`; the one-day simulation,
 * `scripts/simulate-day/day.spec.ts`). Absent, the browser stays on the
 * fallback instant, which is the frozen clock the fleet boots at.
 */
export const BROWSER_CLOCK_COOKIE = "diveday_sim_clock";

/**
 * Pin the browser clock in an init script, so it is in place before the first
 * navigation of every page the context opens. Only argless `new Date()` and
 * `Date.now()` are pinned; parsing, every Date method and `instanceof Date`
 * are inherited unchanged, and real timers are left alone.
 *
 * The instant is read from {@link BROWSER_CLOCK_COOKIE} at document start, so
 * moving the clock is one cookie write and the next navigation sees it.
 */
export async function pinBrowserClock(context: BrowserContext, fallback: string): Promise<void> {
  await context.addInitScript(
    ({ cookie, fallbackIso }) => {
      const match = document.cookie.match(new RegExp(`(?:^|; )${cookie}=([^;]+)`));
      const fixed = new Date(match ? decodeURIComponent(match[1]) : fallbackIso).getTime();
      const RealDate = Date;
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
        get: (target, prop, receiver) =>
          prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
      });
    },
    { cookie: BROWSER_CLOCK_COOKIE, fallbackIso: fallback },
  );
}
