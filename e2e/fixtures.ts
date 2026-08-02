import path from "node:path";
import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { signInAs } from "./helpers";
import { E2E_FROZEN_CLOCK, e2eBaseURL } from "./servers";

type StaffRole = keyof typeof DEV_STAFF_LOGINS;

/**
 * Patches `getByText`/`getByRole`/`getByLabel`/`getByPlaceholder` on a Page
 * instance to filter to visible-only matches — see the `page` fixture below
 * for why all four need it, not just `getByText` as Next's own docs suggest.
 * The `page` fixture applies this automatically; a spec that opens a second
 * actor's page via `browser.newContext()`/`context.newPage()` (a separate
 * `Page` instance the fixture never touches) must call this on it directly,
 * e.g. `const staffPage = makeActivitySafe(await staffContext.newPage());`.
 */
export function makeActivitySafe(page: Page): Page {
  const rawGetByText = page.getByText.bind(page);
  page.getByText = ((text: string | RegExp, options?: { exact?: boolean }) =>
    rawGetByText(text, options).filter({ visible: true })) as Page["getByText"];
  const rawGetByRole = page.getByRole.bind(page);
  page.getByRole = ((role: Parameters<Page["getByRole"]>[0], options?: object) =>
    rawGetByRole(role, options).filter({ visible: true })) as Page["getByRole"];
  const rawGetByLabel = page.getByLabel.bind(page);
  page.getByLabel = ((text: string | RegExp, options?: { exact?: boolean }) =>
    rawGetByLabel(text, options).filter({ visible: true })) as Page["getByLabel"];
  const rawGetByPlaceholder = page.getByPlaceholder.bind(page);
  page.getByPlaceholder = ((text: string | RegExp, options?: { exact?: boolean }) =>
    rawGetByPlaceholder(text, options).filter({ visible: true })) as Page["getByPlaceholder"];
  return page;
}

/**
 * Each Playwright worker owns a private Next server + in-memory database (see
 * playwright.config.ts). A worker's base URL is derived from its parallel
 * index so its page and request fixtures always talk to that worker's own
 * server — this is what lets the suite run `fullyParallel` without one test's
 * mutation leaking into another's assertions.
 */
export const test = base.extend<
  { demoReset: undefined },
  { workerBaseURL: string; staffStorageState: (role: StaffRole) => Promise<string> }
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
      await use(undefined);
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
  context: async ({ context, workerBaseURL }, use) => {
    await context.addInitScript((iso) => {
      const fixed = new Date(iso).getTime();
      const RealDate = Date;
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
        get: (target, prop, receiver) =>
          prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
      });
    }, E2E_FROZEN_CLOCK);

    await context.addInitScript(() => {
      const isOfflineCookie = document.cookie
        .split("; ")
        .some((c) => c.startsWith("playwright_offline=true"));
      let offline = isOfflineCookie;
      window.addEventListener("online", () => {
        offline = false;
      });
      window.addEventListener("offline", () => {
        offline = true;
      });
      Object.defineProperty(navigator, "onLine", {
        get: () => !offline,
        configurable: true,
      });
    });

    const originalSetOffline = context.setOffline.bind(context);
    context.setOffline = async (offline: boolean) => {
      const pages = context.pages();
      let url = pages[0]?.url() || workerBaseURL;
      // A page can legitimately be sitting on a non-http(s) URL here — most
      // often a Chrome error interstitial (chrome-error://chromewebdata/)
      // left behind by a *previous* setOffline(true) + a reload that was
      // expected to fail outright (e.g. a route with no offline fallback).
      // addCookies rejects a url in any scheme but http(s) with "Invalid
      // cookie fields", so anything other than a real http(s) origin falls
      // back to the worker's own base URL instead.
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = workerBaseURL;
      }
      await context.addCookies([
        {
          name: "playwright_offline",
          value: offline ? "true" : "false",
          url,
        },
      ]);
      await originalSetOffline(offline);

      for (const page of pages) {
        try {
          await page.evaluate((isOffline) => {
            window.dispatchEvent(new Event(isOffline ? "offline" : "online"));
          }, offline);
        } catch {
          // ignore failures on unprimed pages
        }
      }
    };
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

  // Next's docs (`preserving-ui-state.md`'s Testing section) say `getByRole`/
  // `getByLabel`/`getByPlaceholder` are already visibility-safe because they
  // query the accessibility tree, which is supposed to exclude a `display:none`
  // route React's <Activity> keeps in the DOM for instant back-navigation
  // (cacheComponents, see ADR 20260801-cache-components-e2e-activity-migration).
  // Phase 2 of that ADR's migration plan proved that claim false for this app:
  // navigating from the public schedule list (which renders
  // `LastMinuteListForm`'s "Name" input) to a trip detail page (which renders
  // its own "Name" input via `BookingPartyFields`) left both inputs reachable
  // by `getByLabel("Name")` — a real strict-mode "resolved to 2 elements"
  // failure, not a flake, confirmed by inspecting both inputs' markup against
  // the source. `getByRole` showed the same failure independently
  // (`getByRole("alert")` resolving to two alerts across a navigation). So all
  // three are patched here exactly like `getByText` below, at the one fixture
  // choke point every spec already imports through, rather than trusting the
  // docs' claim per-callsite.
  // A spec that genuinely needs to match hidden content (e.g. asserting
  // `toBeHidden()`) can bypass this with `page.locator(...)`, which this
  // fixture leaves unpatched.
  page: async ({ page }, use) => {
    await use(makeActivitySafe(page));
  },

  // One real UI sign-in per (worker, role) pair — lazy and memoized, so a
  // worker that only ever needs "owner" still only pays for "owner". This
  // was the single largest cost in the suite before the owner case alone was
  // cached (~27 sign-ins at ~2s each); role-permissions.spec.ts's three
  // tests each doing their own live sign-in for a different role was the
  // same cost multiplied across roles instead of just tests. auth.spec.ts
  // still exercises the live sign-in/sign-out flow.
  staffStorageState: [
    async ({ workerBaseURL, browser }, use, workerInfo) => {
      const cache = new Map<StaffRole, Promise<string>>();
      const resolve = (role: StaffRole): Promise<string> => {
        let cached = cache.get(role);
        if (!cached) {
          cached = (async () => {
            const statePath = path.join(
              workerInfo.project.outputDir,
              `.${role}-session-${workerInfo.parallelIndex}.json`,
            );
            const context = await browser.newContext({ baseURL: workerBaseURL });
            const page = await context.newPage();
            await signInAs(page, DEV_STAFF_LOGINS[role]);
            await context.storageState({ path: statePath });
            await context.close();
            return statePath;
          })();
          cache.set(role, cached);
        }
        return cached;
      };
      await use(resolve);
    },
    { scope: "worker" },
  ],
});

/**
 * Start every test in the calling scope (file or describe block) signed in as
 * the given seeded staff role, via a per-worker saved session cached the
 * first time that role is requested. Tests that must begin signed out
 * (public flows, auth itself, or a flow that specifically exercises signing
 * in) simply don't call this.
 */
export function signedInAs(role: StaffRole) {
  test.use({
    storageState: async ({ staffStorageState }, use) => {
      await use(await staffStorageState(role));
    },
  });
}

export function signedInAsOwner() {
  signedInAs("owner");
}

export { expect };
