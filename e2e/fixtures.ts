import path from "node:path";
import { test as base, expect } from "@playwright/test";
import { signInAsOwner } from "./helpers";
import { E2E_FROZEN_CLOCK, e2eBaseURL } from "./servers";

/**
 * Each Playwright worker owns a private Next server + in-memory database (see
 * playwright.config.ts). A worker's base URL is derived from its parallel
 * index so its page and request fixtures always talk to that worker's own
 * server — this is what lets the suite run `fullyParallel` without one test's
 * mutation leaking into another's assertions.
 */
export const test = base.extend<
  { demoReset: void },
  { workerBaseURL: string; ownerStorageState: string }
>({
  // Reset this worker's demo shop to the seeded fixture before every test so
  // each starts from the same baseline regardless of order. This is an `auto`
  // fixture, not a top-level `test.beforeEach`: a `beforeEach` declared in an
  // imported fixtures module only attaches to some spec files (the ones whose
  // tests sit at the file's top level), so the many specs that wrap their tests
  // in `test.describe(...)` silently ran with no reset — their trips and
  // bookings then leaked into every later spec's fixture and made the shared
  // public-schedule assertions (trips.spec) flake. An `auto` fixture runs for
  // every test that uses this `test`, describe-nested or not. It depends only
  // on `request` (an API call to the worker's own server), so parallel resets
  // never interfere; the browser clock is frozen in the `context` fixture below.
  demoReset: [
    async ({ request }, use) => {
      await request.post("/api/test/reset");
      await use();
    },
    { auto: true },
  ],

  // Pin the browser clock to the same instant the server is frozen at
  // (DIVEDAY_CLOCK, see src/lib/clock.ts) at context creation, so the override
  // is in place before the first navigation of every test — including the first
  // test after a `signedInAsOwner` (storageState) context, where registering it
  // in a beforeEach raced the initial navigation and let one test through on the
  // real clock. With the server render, the clock-anchored seed, and the browser
  // all on one instant, relative-time UI is stable for visual regression and
  // browser-stamped events (offline roll-call sync, signatures) never look "future" to the
  // server's frozen clock and get rejected as stale.
  //
  // Only argless `new Date()` / `Date.now()` are pinned; parsing (`new
  // Date(iso)`), every Date method, and `instanceof Date` are inherited
  // unchanged, and real timers are left alone — so event- and timer-driven UI
  // (the offline reconcile, debounced search) behaves exactly as in production.
  context: async ({ context }, use) => {
    await context.addInitScript((iso) => {
      const fixed = new Date(iso).getTime();
      const RealDate = Date;
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
        get: (target, prop, receiver) =>
          prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
      });
    }, E2E_FROZEN_CLOCK);
    // The trip detail page embeds a live Google Maps iframe (DiveSiteMap.tsx).
    // DIVEDAY_DISABLE_EXTERNAL_HTTP keeps the *server* from waiting on a
    // third-party forecast, but that flag can't reach this request — it's the
    // browser loading the iframe directly, not our server code. Left
    // unblocked, an environment with restricted outbound egress can make this
    // request hang for several seconds before failing, which a plain
    // `page.goto` (default `waitUntil: "load"`) then waits out in full,
    // risking the suite's tight per-test timeout on any page a dive site map
    // appears on. Aborting it immediately keeps every test's network
    // footprint inside this worker's own server, matching the same
    // no-third-party-dependency principle.
    await context.route("https://maps.google.com/**", (route) => route.abort());
    await use(context);
  },

  // Playwright derives fixture dependencies from the first argument's
  // destructuring pattern, so it must stay an object pattern even though this
  // worker fixture depends on nothing but its worker index.
  workerBaseURL: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern.
    async ({}, use, workerInfo) => {
      await use(e2eBaseURL(workerInfo.parallelIndex));
    },
    { scope: "worker" },
  ],

  // Point the built-in page/request fixtures at this worker's own server.
  baseURL: async ({ workerBaseURL }, use) => {
    await use(workerBaseURL);
  },

  // One real UI sign-in per worker; every staff test after that starts from
  // the saved session instead of walking the sign-in form again (which was
  // the single largest cost in the suite — ~27 sign-ins at ~2s each).
  // auth.spec.ts still exercises the live sign-in/sign-out flow.
  ownerStorageState: [
    async ({ workerBaseURL, browser }, use, workerInfo) => {
      const statePath = path.join(
        workerInfo.project.outputDir,
        `.owner-session-${workerInfo.parallelIndex}.json`,
      );
      const context = await browser.newContext({ baseURL: workerBaseURL });
      const page = await context.newPage();
      await signInAsOwner(page);
      await context.storageState({ path: statePath });
      await context.close();
      await use(statePath);
    },
    { scope: "worker" },
  ],
});

/**
 * Start every test in the calling scope (file or describe block) signed in as
 * the seeded owner, via the per-worker saved session. Tests that must begin
 * signed out (public flows, auth itself) simply don't call this.
 */
export function signedInAsOwner() {
  test.use({
    storageState: async ({ ownerStorageState }, use) => {
      await use(ownerStorageState);
    },
  });
}

export { expect };
