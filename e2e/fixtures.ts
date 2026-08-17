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
  // Page-level patches do not propagate to locators created from a locator:
  // `section.getByLabel(...)` calls Locator.prototype directly. Patch the
  // prototype once per worker so every descendant query observes the same
  // visible-only contract, including the preserved hidden <Activity> trees.
  const locatorPrototype = Object.getPrototypeOf(page.locator("body")) as Record<
    PropertyKey,
    unknown
  >;
  const marker = Symbol.for("diveday.playwright.visible-locators");
  if (!locatorPrototype[marker]) {
    for (const method of ["getByText", "getByRole", "getByLabel", "getByPlaceholder"]) {
      const original = locatorPrototype[method];
      if (typeof original !== "function") continue;
      locatorPrototype[method] = function (this: object, ...args: unknown[]) {
        const locator = Reflect.apply(original, this, args) as {
          filter: (options: { visible: true }) => unknown;
        };
        return locator.filter({ visible: true });
      };
    }
    locatorPrototype[marker] = true;
  }

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
 * A test's own statement that it only **reads**. The tag is descriptive
 * metadata; `demoReset` still runs for every test so read-only assertions do
 * not inherit mutations from an earlier test.
 *
 * ```ts
 * test("the schedule's filters narrow the list", { tag: READ_ONLY }, async ({ page }) => {
 * ```
 *
 * The reset exists because a test that mutates the demo shop leaks its trips
 * and bookings into every later spec's fixture (see that fixture's comment for
 * the flake it was introduced to kill). Resetting every test keeps each test's
 * seeded assertions independent of Playwright's test order.
 *
 * **This is an assertion by the author, and no check can prove it.** Writing
 * the tag is the claim; a form submit, a server action, or a demo-shop mint
 * added to that test later invalidates it, and the tag must come off. Deliberately
 * not a lint rule that greps for `.click()`/`.fill()`: half the tests wearing
 * this tag click filters, type in search boxes and open disclosures without
 * touching a row, so such a check would be wrong in both directions.
 *
 * Read-only means "writes nothing", not "signs in nothing" — `signedInAs*` is
 * fine under it, since the sign-in fixture mints its state in its own context.
 *
 * Per **test**, not per file, and that is the point of it being a tag rather
 * than the second `test` export this replaces: with a file-level import, a test
 * added underneath it months later inherited a claim nobody re-checked, silently
 * and invisibly. A tag defaults the other way — an untagged test pays the reset —
 * and it says so on the test's own line, in the runner's output, and to
 * `--grep @read-only`. Each file also carries one line in its docblock saying
 * *why* the claim holds there, so the next author meets the constraint rather
 * than discovering it.
 */
export const READ_ONLY = "@read-only";

/** A shop minted for one test alone — see the `privateShop` fixture below. */
export type PrivateShop = {
  /** The minted shop's slug, for every `/shop/<slug>/…` and `/s/<slug>/…` path. */
  slug: string;
  /** The owner `page` is signed in as. */
  ownerEmail: string;
};

/**
 * Each Playwright worker owns a private Next server + in-memory database (see
 * playwright.config.ts). A worker's base URL is derived from its parallel
 * index so its page and request fixtures always talk to that worker's own
 * server — this is what lets the suite run `fullyParallel` without one test's
 * mutation leaking into another's assertions.
 *
 * Within a worker, `demoReset` restores the shared blue-mantis fixture's
 * *schedule* before every test; a test that writes the shop's **settings**
 * takes a whole shop of its own through `privateShop` below.
 */
export const test = base.extend<
  { demoReset: undefined; privateShop: PrivateShop },
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
      // Every test pays the reset, including tests tagged READ_ONLY. A test
      // that writes nothing can still inherit mutations from the previous
      // test, so READ_ONLY is descriptive metadata rather than an isolation
      // opt-out. Skipping the reset made seeded read-only assertions depend on
      // Playwright's test order and produced cross-test failures in CI.
      const response = await request.post("/api/test/reset");
      // Fail *here*, naming the reset, rather than letting the test run on a
      // half-wrecked shop. `resetDemoSchedule` is a hand-maintained topological
      // delete, so a new table with a shop-scoped FK that nobody added to the
      // ordering makes it throw 23503 partway: the deletes before the violation
      // have already landed, the re-seed never runs, and the shop is left
      // missing whatever the reset got to first. The status was previously
      // discarded, so that corruption surfaced as an unrelated assertion in
      // whichever spec read the wreckage next — which is how it took a
      // 25-spec-wide failure to notice the blow-out cascade's two tables were
      // missing from the ordering, and why the same bug class went unnoticed
      // once before (see the last-minute-unsubscribe comments in src/db/seed.ts).
      if (!response.ok()) {
        throw new Error(
          `demo reset failed: POST /api/test/reset returned ${response.status()}. ` +
            `Every later assertion in this spec would be reading a half-reset shop. ` +
            `A 500 here is usually a missing delete in resetDemoSchedule's ordering ` +
            `(src/db/seed.ts) for a newly added table. Body: ${await response.text()}`,
        );
      }
      await use(undefined);
    },
    { auto: true },
  ],

  // A whole seeded shop of this test's own, with `page` signed in as its
  // owner. Ask for it when the test writes **shop-wide** state — anything the
  // per-test reset above does not restore, and so anything that would change
  // the premise of whichever spec Playwright's sharding runs next in this
  // worker (ADR 20260815-per-test-private-shops).
  //
  // The reset restores blue-mantis's *schedule*: trips, bookings, waivers, the
  // roster, the catalog, the promo codes, three `shops` columns. It does not
  // restore the shop's backup destination or its delivery history, its
  // WhatsApp sender, its media-deletion attempts, any other `shops` column, or
  // the shifts and calendar feeds of the four permanent staff. A test writing
  // one of those takes a shop of its own instead.
  //
  // Lazy, like every Playwright fixture: only a test that destructures
  // `privateShop` pays the mint (~1.5s) and the sign-in (~1.5s) — budget for
  // both with `test.setTimeout`, since test-scoped fixture setup is inside the
  // test's own timeout. Teardown drops the shop again, so the cascade delete
  // is charged to the test that asked for it rather than landing inside the
  // *next* test's 15-second budget; `demoReset`'s `purgeMintedDemoShops` is
  // still the safety net when a run dies before teardown.
  //
  // A file using this must **not** also call `signedInAsOwner()`: that seeds a
  // blue-mantis session into the same context, and the two would race for the
  // cookie.
  privateShop: async ({ demoReset, request, page }, use) => {
    // Named only for ordering: the reset purges the *previous* test's minted
    // shop, and it has to have run before this one mints its replacement.
    void demoReset;
    const response = await request.post("/api/test/seed-private-shop");
    if (!response.ok()) {
      throw new Error(
        `private shop mint failed: POST /api/test/seed-private-shop returned ` +
          `${response.status()}. Body: ${await response.text()}`,
      );
    }
    const minted = (await response.json()) as {
      slug: string;
      ownerEmail: string;
      password: string;
    };
    await signInAs(page, { email: minted.ownerEmail, password: minted.password });
    await use({ slug: minted.slug, ownerEmail: minted.ownerEmail });
    // Best-effort: a teardown failure must not turn a passing test red, and
    // the next reset would clear the shop regardless.
    await request
      .delete(`/api/test/seed-private-shop?slug=${encodeURIComponent(minted.slug)}`)
      .catch(() => {});
  },

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
            try {
              const page = await context.newPage();
              await signInAs(page, DEV_STAFF_LOGINS[role]);
              await context.storageState({ path: statePath });
              return statePath;
            } finally {
              await context.close();
            }
          })();
          cache.set(role, cached);
          // A transient storage-state write failure (for example, another
          // Playwright run clearing the shared output directory) must not turn
          // into a permanent worker-wide failure. Keep a successful session,
          // but evict this exact rejected promise so the next staff test can
          // sign in again. The identity check prevents an older failure from
          // deleting a retry that has already replaced it.
          void cached.catch(() => {
            if (cache.get(role) === cached) cache.delete(role);
          });
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
