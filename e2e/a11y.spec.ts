import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signOut } from "./helpers";

/**
 * Automated a11y scan for the current page state — WCAG 2.0 A/AA plus 2.2 AA,
 * the same rule set the specialist optimization audit's accessibility lens
 * (§3) called for. See ADR 20260801-axe-core-playwright-a11y-scans. A
 * violation here means a real, tool-detectable defect (missing label, bad
 * contrast, broken landmark structure) — triage it into a fix rather than
 * excluding the rule, unless it's a genuine false positive (document why
 * inline if so).
 *
 * `color-contrast` is excluded, not a false positive: it fires on every
 * surface this scan covers, and every instance traces back to the same
 * design-token values the audit's own contrast tasks (§3, "focus indicator",
 * "status-banner text", "placeholder text") already track as open work. The
 * product owner has explicitly ruled out touching contrast values in this
 * change — they'd fight the current color guide — so this scan enforces
 * everything else axe checks (labels, roles, landmarks, focus order,
 * `aria-live` wiring) without going permanently red over already-tracked,
 * deliberately deferred contrast debt. Re-include it once that work lands.
 */
async function expectNoA11yViolations(page: Page) {
  // A dynamic route with no build-time param coverage (a just-created trip,
  // never visited before) computes its <title> from a DB read inside
  // generateMetadata — under cacheComponents' Partial Prerendering, that
  // resolves on the same postponed-content channel as the page body, but not
  // always in lockstep with it: a scan that fires the instant the body's own
  // heading becomes visible can still catch a document with no <title> yet,
  // even though the page settles correctly moments later. Waiting for a
  // non-empty title first scans the settled document instead of a genuinely
  // transient in-between state — this is not a real a11y defect a visitor
  // ever perceives, just the render finishing.
  await expect(page).toHaveTitle(/.+/);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

signedInAsOwner();

test.describe("automated accessibility scans (specialist optimization audit §3)", () => {
  test("the public schedule has no automated a11y violations", async ({ page }) => {
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the trip booking page and its confirmation have no automated a11y violations", async ({
    page,
  }) => {
    const title = `A11y Scan Trip ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:30");
    await page.getByLabel("Capacity").fill("6");
    await page.getByLabel(/Price per diver/).fill("120");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page).not.toHaveURL(/\/trips\/new/);

    // Staff viewing their own shop's booking page get redirected to the trip's
    // management view instead (src/app/s/[shopSlug]/trips/[id]/page.tsx)
    // — a diver never carries a staff session, so scan the page the way a real
    // visitor sees it.
    await signOut(page);
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel("Name", { exact: true }).fill("Ada Reef");
    await page.getByLabel("Email", { exact: true }).fill(`ada-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Ada/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the waiver page has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    const diverSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
    await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
    const waiverHref = await diverSection
      .getByRole("status")
      .getByRole("link")
      .getAttribute("href");

    await page.goto(waiverHref ?? "/");
    await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the staff manifest page has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Manifest" })
      .click();
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the offline manifest viewer has no automated a11y violations", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    // Visiting the trip's own live Manifest page is what saves a device copy
    // in the first place (src/lib/offline-manifests.ts) — going straight to
    // /offline-manifest without it first renders the empty "nothing saved"
    // state instead of a real roster.
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Manifest" })
      .click();
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];

    await page.goto(`/offline-manifest?trip=${tripId}`);
    await expect(page.getByRole("heading", { name: /roll call/i })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

/**
 * The staff data-entry surfaces, scanned as a table.
 *
 * The five flow-shaped scans above follow a diver or a captain through the
 * safety-critical pages. What they never reach is the other half of the app:
 * the static staff routes a front desk types into all day, which are the
 * densest label/fieldset/table surfaces in the product and so the ones an
 * automated label/role/landmark scan has the most to say about. Every route
 * here is reachable by URL alone, so the table is the whole test — `goto`,
 * wait for the page's own `<h1>` (never a skeleton), scan.
 *
 * Split into three tests rather than one, and grouped by the part of the shop
 * they belong to, so a failure names a neighbourhood rather than "the staff
 * scan". Each scan costs ~3.5s here (the `networkidle` wait dominates), which
 * is what every `test.setTimeout` below is sized from.
 *
 * Every staff route reachable by URL is in a table below — there are no
 * exclusions left. Three routes were carried out-of-table for one change while
 * the markup they tripped on was fixed in `src/app/**` (`/orders/new`'s
 * unlabelled line-item kind pickers, `/settings`' unlabelled packing-list
 * textarea, `/waivers`' colour-only inline link); all three now scan clean and
 * are back in. If a new violation turns up, fix the markup — a route dropped
 * from this table is debt no one can see.
 */
type StaffScan = {
  /** A URL a signed-in staff member can type. */
  path: string;
  /** The page's own `<h1>`, waited for so no scan lands on a loading skeleton. */
  heading: string | RegExp;
};

async function scanStaticRoutes(page: Page, routes: readonly StaffScan[]) {
  for (const route of routes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
      `${route.path} never rendered its <h1>`,
    ).toBeVisible();
    await expectNoA11yViolations(page);
  }
}

test.describe("automated accessibility scans of the static staff routes", () => {
  test("the front-desk and scheduling surfaces have no automated a11y violations", async ({
    page,
  }) => {
    // 7 scans at ~3.5s each, plus the sign-in state and first cold render.
    test.setTimeout(90_000);
    await scanStaticRoutes(page, [
      // Today, in both of its views. `/blockers` is a permanent redirect to
      // `?view=departures` now (ADR 20260803-not-ready-is-a-view), so this
      // scans the by-departure queue through the URL staff bookmarks — same
      // greeting `<h1>`, a completely different body.
      { path: "/shop/blue-mantis", heading: /Good (morning|afternoon|evening|night), Dana/ },
      {
        path: "/shop/blue-mantis/blockers",
        heading: /Good (morning|afternoon|evening|night), Dana/,
      },
      { path: "/shop/blue-mantis/check-in", heading: "Counter check-in" },
      { path: "/shop/blue-mantis/check-in/walk-in", heading: "Walk-in" },
      { path: "/shop/blue-mantis/schedule/board", heading: "Board" },
      { path: "/shop/blue-mantis/trips/new", heading: "Schedule a trip or course session" },
      { path: "/shop/blue-mantis/divers", heading: "Divers" },
    ]);
  });

  test("the money, catalog and roster surfaces have no automated a11y violations", async ({
    page,
    request,
  }) => {
    // 10 scans at ~3.5s each.
    test.setTimeout(110_000);
    // The orders index only has rows to render (and `/orders/new` only exists
    // at all) for a shop that can take money. This is a pure DB write that
    // never calls Stripe — the same door e2e/visual.spec.ts opens for the
    // recap tip section.
    await request.post("/api/test/seed-stripe-account");
    await scanStaticRoutes(page, [
      { path: "/shop/blue-mantis/orders", heading: "Orders" },
      { path: "/shop/blue-mantis/orders/new", heading: "New order" },
      { path: "/shop/blue-mantis/promos", heading: "Discounts a diver can type" },
      { path: "/shop/blue-mantis/reviews", heading: "What divers said" },
      { path: "/shop/blue-mantis/reports", heading: "How's your month" },
      { path: "/shop/blue-mantis/staffing", heading: "Staffing" },
      { path: "/shop/blue-mantis/courses", heading: "Courses" },
      { path: "/shop/blue-mantis/waivers", heading: "Waiver template" },
      { path: "/shop/blue-mantis/dive-sites", heading: "Dive-site library" },
      { path: "/shop/blue-mantis/dive-sites/catalog", heading: "DiveDay common dive sites" },
    ]);
  });

  test("the settings surfaces and the not-found backstop have no automated a11y violations", async ({
    page,
  }) => {
    // 6 scans at ~3.5s each.
    test.setTimeout(70_000);
    await scanStaticRoutes(page, [
      { path: "/shop/blue-mantis/settings", heading: "Shop settings" },
      { path: "/shop/blue-mantis/settings/team", heading: "Team" },
      { path: "/shop/blue-mantis/settings/import", heading: "Import contacts" },
      { path: "/shop/blue-mantis/settings/export", heading: "Data export" },
      { path: "/shop/blue-mantis/settings/calendar", heading: "Calendar subscriptions" },
      // The app-wide `notFound()` backstop (src/app/not-found.tsx). Scanned
      // under a staff session because that is the session a mistyped `/shop`
      // URL is carried by — signed out, the same URL is an auth redirect to
      // /sign-in, which is scanned in its own right below.
      { path: "/shop/blue-mantis/no-such-page", heading: "We couldn’t find that page" },
    ]);
  });
});

/**
 * The same table, signed out — the marketing front door, the two account
 * forms, and the diver-facing shop namespace (`/s/<slug>`, ADR
 * 20260803-public-shop-namespace).
 *
 * `test.use` with an empty storage state overrides the file-level
 * `signedInAsOwner()`: these are the pages a visitor with no session sees, and
 * several of them (the landing page, `/sign-in`) render differently for a
 * signed-in staff member or bounce them elsewhere entirely.
 *
 * ## Absent, and why
 *
 * The seeded reef trip's public briefing (`/s/blue-mantis/trips/<id>`) is not
 * here. It is the one diver surface `expectNoA11yViolations` cannot scan: the
 * page embeds a Google Maps satellite iframe (which the context fixture in
 * e2e/fixtures.ts aborts) and externally hosted site photos proxied through
 * `/_next/image` (which the sealed e2e fleet can never fetch), so the document
 * never reaches the `networkidle` state the scan waits for and the test hangs
 * until its own timeout. A public trip *booking* page is covered instead by
 * "the trip booking page and its confirmation" above, which scans a trip the
 * test creates — no dive site, so no map and no photos.
 */
test.describe("automated accessibility scans of the signed-out surfaces", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the marketing, account and diver surfaces have no automated a11y violations", async ({
    page,
  }) => {
    // 6 scans at ~3.5s each.
    test.setTimeout(60_000);
    await scanStaticRoutes(page, [
      // The landing page and the two account-lifecycle forms. Each renders a
      // single `<h1>`, so matching any non-empty one is enough and keeps this
      // table from re-stating marketing copy that is meant to change.
      { path: "/", heading: /\S/ },
      { path: "/sign-in", heading: /\S/ },
      { path: "/onboard", heading: /\S/ },
    ]);

    // The diver-facing shop. Its `<h1>` is served in the static shell while
    // the departure list streams, so this waits on the list itself — the same
    // race the "public schedule" scan at the top of this file documents.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    await expectNoA11yViolations(page);

    await scanStaticRoutes(page, [
      { path: "/s/blue-mantis/courses", heading: "Courses" },
      { path: "/s/blue-mantis/courses/paths", heading: "Certification paths" },
    ]);
  });
});
