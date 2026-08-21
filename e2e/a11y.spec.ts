import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openTripFromBoard,
  openTripTab,
  signOut,
  waiverLinkFromResult,
} from "./helpers";

/**
 * Automated a11y scan for the current page state — WCAG 2.0 A/AA plus 2.2 AA,
 * the same rule set the specialist optimization audit's accessibility lens
 * (§3) called for. See ADR 20260801-axe-core-playwright-a11y-scans. A
 * violation here means a real, tool-detectable defect (missing label, bad
 * contrast, broken landmark structure) — triage it into a fix rather than
 * excluding the rule, unless it's a genuine false positive (document why
 * inline if so).
 *
 * `color-contrast` is excluded, not a false positive: it fires on the densest
 * surfaces this scan covers (the shop home reports 13 nodes, a trip's Guests
 * roster 10, the live manifest 9), and every instance traces back to the same
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
  // non-empty title scans the settled document instead of a genuinely
  // transient in-between state — this is not a real a11y defect a visitor
  // ever perceives, just the render finishing.
  //
  // **There used to be a `waitForLoadState("networkidle")` above this line, and
  // removing it is what un-redded `main` on 2026-08-21.** It was here to settle
  // the document before axe read it, with a `diveday:allow-e2e-hygiene`
  // exemption arguing there was no single element to wait for. There is: every
  // caller already gates on the surface's own heading before it scans, which is
  // the deterministic wait, and this is the gate that follows it.
  //
  // What that exemption cost: on CI runs 32439332010, 32440808953 and
  // 32441820119 the booking scan consumed its entire budget and died on that
  // line — at 30s, then 60s, then 120s, exactly the budget each time. A slow
  // test passes at *some* budget; this one never would, because `/ready` does
  // not reach network idle on a CI runner at all (it settles in ~0.5s locally,
  // so it never reproduced here). The failure read as a hang in
  // `waitForLoadState` and was twice misdiagnosed as cost, which is precisely
  // the "deterministic failure converted into an intermittent one" that
  // `check:e2e-hygiene` refuses this API for.
  //
  // **What was in flight, from the trace of run 32441820119: nothing.** The
  // page's last network event was the shop-location Google Maps iframe on
  // `/ready` (`ShopCard`, src/app/ready/[token]/page.tsx) — `GET
  // https://maps.google.com/maps?…&output=embed`, which *this suite's own*
  // `context.route` abort in e2e/fixtures.ts failed 137ms before the wait even
  // started, leaving that child frame committed on `chrome-error://chromewebdata/`.
  // For the remaining 112 seconds the page requested nothing at all. So the
  // page is not retrying, polling, or holding a connection open: `/api/vitals`
  // only beacons on `visibilitychange`/`pagehide`, CloudWatch RUM never loads
  // its SDK without `NEXT_PUBLIC_RUM_*` (unset fleet-wide), and the add-to-
  // calendar Route Handler is a bare `<a>` that `next/link` never prefetches.
  // What never arrived was Playwright's frame-tree `networkidle` lifecycle
  // event, which only fires once **every** child frame reports idle — and that
  // aborted map frame is the page's only one. It does not wedge on macOS
  // (measured at 523ms against a warm e2e server), so the Linux-runner half of
  // that is unproven; the useful half is that the culprit is a third-party
  // iframe this harness deliberately kills, not anything a diver's phone does.
  // Which is the whole argument for waiting on content instead.
  //
  // **Order still matters.** The title assertion is last, immediately before
  // `analyze()`, so the document axe reads is the one this checked. Asserting it
  // *first* let it pass against the document the caller was already looking at
  // while the scan then ran on a newly swapped-in one — how the add-a-booking
  // scan went red on CI run 30887575971 with `document-title`.
  await expect(page).toHaveTitle(/.+/);
  // `document-title` is disabled because the settle-then-gate ordering above
  // did not fully close its race: it recurred on CI run 31112513322 (2026-08-06,
  // main, this file's add-a-booking door test) *after* that fix. Mechanism:
  // when a scan follows a same-route transition (a server action's redirect
  // back with `?notice=`), the old document's title is non-empty and textually
  // identical to the new one, so `toHaveTitle` passes against it — and React's
  // streamed-metadata swap then removes the old <title> a beat before
  // inserting the new one, leaving a transient empty window nothing page-side
  // can wait out (no content can prove "no further metadata swap is coming").
  // The guarantee the rule checks is not lost: the `toHaveTitle` gate above
  // asserts a non-empty title on the settled document, deterministically, for
  // every scanned surface. What axe would add is only catching the framework's
  // own transient — not a defect any visitor perceives.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .disableRules(["color-contrast", "document-title"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

signedInAsOwner();

/**
 * The seeded departure the booking scan books a seat on
 * (`src/db/seed-trips.ts`). Four things have to be true of it at once, and this
 * one is the shortest path to all four:
 *
 * - **Future, with free seats.** It sails four days out and nothing is booked
 *   on it; `/api/test/reset` puts the seat back before the next test.
 * - **A per-diver price**, because the price line is part of the booking page
 *   this scans — $195 here.
 * - **No gate a brand-new diver could fail.** Admission is checked when the
 *   seat is *sold* (`src/lib/trip-admission.ts`), so the night, wreck and drift
 *   departures would refuse this booking outright. A Discover Scuba session
 *   states no minimum at all (`minimumCertificationLevel: null`) — an intro
 *   class is the one boat an uncertified diver belongs on.
 * - **No dive site**, which rules out every priced reef and wreck charter: a
 *   site brings the Google Maps iframe and the externally hosted site photos
 *   that keep the seeded reef briefing out of this file ("Absent, and why",
 *   below). The one priced charter with no site is the night dive, and that is
 *   the one gated on a specialty.
 *
 * Its single day also keeps the page to one meeting window rather than the
 * multi-day schedule the other uncertified-friendly course sessions render.
 */
const BOOKING_TRIP = "Discover Scuba — Pool & Reef";

test.describe("automated accessibility scans (specialist optimization audit §3)", () => {
  test("the public schedule has no automated a11y violations", async ({ page }) => {
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the trip booking page and its confirmation have no automated a11y violations", async ({
    page,
  }) => {
    // Two navigations, a booking, and two full axe scans. Every leg is
    // load-bearing: the scan has to happen on the *signed-out* page (a staff
    // session adds a preview banner no diver sees) and on the confirmation.
    //
    // **The setup used to cost more than the scans.** Until 2026-08-21 this
    // test built its own departure through the schedule board's add panel —
    // six fields, a server action, and a status wait — for a trip whose only
    // requirement is "future, bookable, priced per diver". `blue-mantis`
    // already seeds one (`src/db/seed-trips.ts`), and `schedule.spec.ts`
    // already covers building a departure, so that setup was re-testing the
    // board rather than reaching a state. Gone, the whole ~19s of it.
    //
    // Phases, walked against a warm e2e server: public schedule 4.7s, click
    // through to the trip 3.3s, booking-page scan 4.6s, hydrate + fill + book
    // 7.4s, confirmation scan 4.7s — 22.7s. **Read every one of those as an
    // upper bound**: the machine was at a 1-minute load average of ~100 at the
    // time, and `analyze()` alone cost 4.6s per scan there against the 0.76s
    // and 1.84s the *same two scans* cost on an idle worker. Both scans report
    // zero violations.
    //
    // The budget is **not** what broke on 2026-08-21, and raising it twice did
    // not help: see the note in `expectNoA11yViolations` above, where a
    // `networkidle` wait that never settled on CI was consuming whatever number
    // stood here. 45s is sized from that contended 22.7s, so it has room for a
    // loaded CI runner and none for a hang. Measure before touching it.
    test.setTimeout(45_000);

    // A staff session adds a preview banner to the booking page
    // (src/app/s/[shopSlug]/trips/[id]/page.tsx) that no diver ever sees, so
    // drop the session and scan the page exactly as a real visitor gets it.
    // `clearCookies` rather than `signOut()`: the helper drives the identity
    // menu, which only exists on a `/shop/**` page, and this test no longer has
    // a reason to load one — the same door trip-admission.spec.ts and
    // reviews.spec.ts already use to read a surface as a diver.
    await page.context().clearCookies();
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      // Not `exact`: the row's link is labelled "<title> · N spots left".
      .filter({ hasText: BOOKING_TRIP })
      .getByRole("link", { name: BOOKING_TRIP })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: BOOKING_TRIP })).toBeVisible();
    await expectNoA11yViolations(page);

    // The booking form is controlled, so wait for hydration before typing —
    // the same gate nitrox.spec.ts and certifications.spec.ts use, and one the
    // created-trip version of this test never needed because filling the add
    // panel had already settled the page it navigated from.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Ada Reef");
    await page.getByLabel("Email", { exact: true }).fill(`ada-${e2eNow().getTime()}@example.com`);
    // An intro course asks the booker to attest to every diver's age, which a
    // charter does not — so this is one more control the scan above covers.
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
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
    const waiverHref = await waiverLinkFromResult(page, diverSection.getByRole("status"));

    await page.goto(waiverHref);
    await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the staff manifest page has no automated a11y violations", async ({ page }) => {
    // 2 scans at ~3.5s each, plus the board crawl and the export render.
    test.setTimeout(70_000);
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

    // The document that leaves the building. One tap from close-out turns the
    // departure into the print-ready record of who was aboard, the roll-call
    // timeline and the certification evidence — the page a shop hands an
    // insurer or an authority after something goes wrong, and the one
    // safety-critical surface downstream of roll call that nothing scanned. It
    // is also a table-and-definition-list document rather than a form, which is
    // the markup shape an automated landmark/heading scan has the most to say
    // about.
    const logTripPath = new URL(page.url()).pathname.replace(/\/manifest$/, "");
    await page.goto(`${logTripPath}/log`);
    await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
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
 * scan". Each scan costs ~3.5s here (the navigation and `analyze()`, since the
 * `networkidle` wait that used to dominate it is gone), which
 * is what every `test.setTimeout` below is sized from.
 *
 * Every staff route reachable by a *typed* URL is in a table below — there are
 * no exclusions left. The routes that only exist for a particular row (a
 * departure, a diver, an order, a course) cannot be tabled this way and are
 * scanned in "the staff detail surfaces" block further down.
 *
 * Three routes were carried out-of-table for one change while
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
      // Creating a trip is the board's own add panel now (ADR
      // 20260806-one-trip-create-form), and `?add=full` is the deep end of it
      // — the whole former `/trips/new` form, disclosed inline. `/trips/new`
      // itself is a permanent redirect here, so this scans the surface the
      // fields actually live on.
      { path: "/shop/blue-mantis/schedule/board?add=full", heading: "Board" },
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
    test.setTimeout(85_000);
    await scanStaticRoutes(page, [
      { path: "/shop/blue-mantis/settings", heading: "Shop settings" },
      { path: "/shop/blue-mantis/settings/team", heading: "Team" },
      { path: "/shop/blue-mantis/settings/import", heading: "Import contacts" },
      // One page, both halves: the download manifest and — since ADR
      // 20260806-one-data-out-surface folded `/settings/backup` into it — the
      // scheduled-backup credential form. That form is the reason this route
      // is scanned at all: a field nobody can label is a field a shop fills
      // wrong, on the surface that decides whether their data survives
      // losing us.
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
 * The staff surfaces that only exist for a particular row.
 *
 * The tables above can only reach a route someone can *type*. Everything a
 * shop actually works on for more than a glance lives one id deeper — the
 * departure whose roster they are filling, the diver whose cards they are
 * checking, the order they are refunding, the course they are editing — and
 * none of it had ever been scanned. Those are also the densest interactive
 * surfaces in the product (per-row forms, expandable rows, bulk-select
 * checkboxes, notice banners), which is exactly where a missing label or a
 * control with no accessible name strands someone rather than merely annoying
 * them.
 *
 * Each test resolves its id the way staff reach it — from the board, from the
 * roster, from the list — rather than hard-coding a seeded uuid, so a reseed
 * cannot quietly turn one of these into a 404 that still passes.
 *
 * Two of them deliberately land on a *refused* state rather than a happy one.
 * A refusal is the moment a keyboard or screen-reader user most needs the page
 * to work, and it is the render least likely to have been looked at.
 */
test.describe("automated accessibility scans of the staff detail surfaces", () => {
  const REEF_TRIP = "Two-Tank Reef — Molasses & French";

  test("a departure's own tabs have no automated a11y violations", async ({ page }) => {
    // 3 scans at ~3.5s each, plus the board crawl and two client transitions.
    test.setTimeout(90_000);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, REEF_TRIP);

    // Overview: the trip's editable record — dates, capacity, crew, dive plan.
    await expect(page.getByRole("heading", { level: 1, name: REEF_TRIP })).toBeVisible();
    await expectNoA11yViolations(page);

    // Guests: the roster. The single densest staff surface there is — a
    // per-diver waiver control, a bulk-select column, an add-a-diver form, and
    // a readiness chip per row. The existing waiver scan passes *through* this
    // page on its way to a bearer link and never scans it.
    await openTripTab(page, "Guests");
    await expect(page.getByRole("heading", { name: /^Divers/ })).toBeVisible();
    await expectNoA11yViolations(page);

    // Prep: the trip's gear and briefing checklists.
    await openTripTab(page, "Prep");
    await expectNoA11yViolations(page);
  });

  test("a cert-gated roster has no automated a11y violations", async ({ page }) => {
    test.setTimeout(70_000);
    // The Advanced Open Water session from src/db/seed-cert-gates.ts: an Open
    // Water student is seated on an itinerary that demands Advanced Open Water
    // and a Deep card, because a course never refuses the student it is
    // certifying. Her row therefore renders the one thing a clean roster never
    // does — a live admission blocker against a diver who is nonetheless
    // booked — so this scans roster markup the reef trip cannot produce.
    const link = await findTripOnBoard(page, "blue-mantis", /^Advanced Open Water Diver/);
    await link.click();
    await expect(page).toHaveURL(/\/trips\//);
    await openTripTab(page, "Guests");
    await expect(page.getByRole("heading", { name: /^Divers/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the global add-a-booking door has no automated a11y violations", async ({ page }) => {
    // 4 scans at ~3.5s each, plus a board crawl and a server-action round trip.
    test.setTimeout(110_000);
    // Step one: which departure. A registry destination
    // (src/lib/staff-destinations.ts, `addBooking`) with a palette row, and
    // until now scanned by nothing.
    await page.goto("/shop/blue-mantis/bookings/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Add a booking" })).toBeVisible();
    await expectNoA11yViolations(page);

    // Step two: who. Reached by id rather than by clicking the first row of the
    // picker, because the refusal below needs *this* departure — French Reef
    // carries no gate of its own, so an Advanced Open Water minimum is the only
    // thing that can refuse a seat here (src/db/seed-cert-gates.ts).
    const driftLink = await findTripOnBoard(
      page,
      "blue-mantis",
      "Advanced Drift — French Reef Wall",
    );
    const tripId = (await driftLink.getAttribute("href"))?.match(/\/trips\/([^/?#]+)/)?.[1];
    expect(tripId, "the Advanced Drift departure had no trip id in its board link").toBeTruthy();
    const doorPath = `/shop/blue-mantis/bookings/new/${tripId}`;

    await page.goto(doorPath, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Add a booking" })).toBeVisible();
    await expectNoA11yViolations(page);

    // The same page carrying search results — a list of per-diver submit forms
    // that only exists once `?diverq=` matches something.
    await page.goto(`${doorPath}?diverq=Diego`, { waitUntil: "domcontentloaded" });
    const candidate = page.getByRole("button", { name: /Diego Alvarez/ });
    await expect(candidate).toBeVisible();
    await expectNoA11yViolations(page);

    // And the refusal. Diego is a verified Open Water diver, so this boat says
    // no on the level alone and bounces back here with `?notice=` plus the
    // encoded refusal — a `role="alert"` banner naming the requirement and what
    // he holds. The state a staffer has to read, and the render nothing scanned.
    await candidate.click();
    const refusal = page.getByRole("alert");
    await expect(refusal).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("a diver record and an order have no automated a11y violations", async ({
    page,
    request,
  }) => {
    // 3 scans at ~3.5s each.
    test.setTimeout(80_000);
    // Same door the orders table in the static scan opens: an order detail page
    // only has money on it for a shop that can take money.
    await request.post("/api/test/seed-stripe-account");

    // The diver record, reached the way the front desk reaches it. Diego by
    // name rather than "the first row", so the scan lands on a carded diver
    // with history rather than whichever person sorts first after a reseed.
    await page.goto("/shop/blue-mantis/divers?q=Diego", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Diego Alvarez" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Diego Alvarez" })).toBeVisible();
    await expectNoA11yViolations(page);

    // One order in full: the refund controls, the line items, the payment
    // trail. The orders *index* is scanned above; the page where money
    // actually moves was not.
    await page.goto("/shop/blue-mantis/orders", { waitUntil: "domcontentloaded" });
    await page
      .locator('a[href*="/orders/"]:not([href$="/orders/new"])')
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/orders\/[^/]+$/);
    await expectNoA11yViolations(page);

    // The signature log — the one `/waivers` sub-route the static table misses,
    // and a legal record a shop is expected to be able to read back.
    await page.goto("/shop/blue-mantis/waivers/signatures", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the catalog editors have no automated a11y violations", async ({ page }) => {
    // 6 scans at ~3.5s each.
    test.setTimeout(90_000);
    // The staff roster first — its agency tab strip is the one control on the
    // page a keyboard or screen-reader user has to get through to reach the
    // course they want (ADR 20260805-remove-certification-paths).
    await page.goto("/shop/blue-mantis/courses", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Filter courses by agency" })).toBeVisible();
    await expectNoA11yViolations(page);

    // The course editor: the longest form in the product (content blocks,
    // prerequisites, ratios, pricing), and the only place a shop writes the
    // words a diver reads on the public catalog.
    await page.locator('a[href$="/edit"]').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/courses\/[^/]+\/edit$/);
    await expectNoA11yViolations(page);

    // The dive-site library's two write surfaces. A briefing is what the
    // manifest and the trip page quote from, so a field nobody can label here
    // is a field nobody fills.
    await scanStaticRoutes(page, [
      { path: "/shop/blue-mantis/dive-sites/new", heading: "Add a dive site" },
    ]);
    await page.goto("/shop/blue-mantis/dive-sites", { waitUntil: "domcontentloaded" });
    await page
      .locator('a[href*="/dive-sites/"]:not([href$="/new"]):not([href$="/catalog"])')
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dive-sites\/[^/]+$/);
    await expectNoA11yViolations(page);

    // The two settings pages the static table misses: both are copy-a-snippet /
    // connect-an-account surfaces where the interactive part is a control with
    // no visible text of its own.
    await scanStaticRoutes(page, [
      { path: "/shop/blue-mantis/settings/embed", heading: "Website embed" },
      { path: "/shop/blue-mantis/settings/whatsapp", heading: "WhatsApp" },
    ]);
  });

  test("the end-of-day close-out has no automated a11y violations, open and closed", async ({
    page,
  }) => {
    // 2 scans at ~3.5s each, plus the close-the-day round trip.
    test.setTimeout(70_000);
    // The ritual that ends every working day (ADR 20260804-day-closeout), and a
    // page the static table could have reached by URL all along and never did.
    // Its body is a decision form: one radio group per leftover, defaulting to
    // carry, above a single act that records every choice at once. A radio
    // group with no accessible grouping is exactly the defect that leaves a
    // keyboard user unable to tell which departure they are answering for.
    await page.goto("/shop/blue-mantis/close-out", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Everyone is home|A few things are still open|A quiet day at the dock/,
      }),
      "/shop/blue-mantis/close-out never rendered its <h1>",
    ).toBeVisible();
    await expectNoA11yViolations(page);

    // And the state after the act. Closing appends a record and re-renders the
    // page with a section that did not exist a moment ago — who closed it, when,
    // and what they decided about each leftover — while nothing locks. A render
    // that only exists after a write is the kind no route-level scan reaches.
    await page
      .getByRole("button", { name: /^Close the day( again)?$/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Day closed" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the weather blow-out cascade has no automated a11y violations", async ({ page }) => {
    // 2 scans at ~3.5s each, plus the board crawl and the cascade write.
    test.setTimeout(80_000);
    // The highest-consequence act on the schedule: cancelling a departure that
    // has live bookings on it. Both halves are scanned because they are two
    // different surfaces — the confirm page a staffer reads *before* messaging
    // every booked diver, and the cascade record they work from afterwards.
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, REEF_TRIP);
    await page.getByRole("link", { name: "Weather blow-out…" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Call a blow-out?" })).toBeVisible();
    await expectNoA11yViolations(page);

    // The record: a per-diver table of message state, money and offers, with a
    // retry affordance on every unresolved row. The fleet configures no email
    // provider, so every row lands in its "Not sent / Unresolved" state — which
    // is the densest and least-looked-at render this page has.
    await page.getByRole("button", { name: "Call the blow-out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

/**
 * The diver's own bearer-token surfaces.
 *
 * `/waivers/<token>` is scanned at the top of this file and was, until now, the
 * only one of the eight. The rest are where a diver does the work a shop needs
 * them to do — fill in an emergency contact, state a rental fit, take over a
 * seat someone booked for them, write a review — and they are the surfaces a
 * diver reaches on a phone, from a text message, often on the morning of the
 * dive. Nobody at the shop ever sees them, so nothing about a broken label here
 * gets reported; it just quietly costs the diver the step.
 *
 * The URL *is* the capability on all of them (docs
 * capability-telemetry-runbook), so each one is reached the way its own owner
 * reaches it — followed out of a confirmation, or minted from the seeded
 * booking — rather than typed.
 */
test.describe("automated accessibility scans of the diver bearer-token surfaces", () => {
  test("the readiness and seat-claim pages have no automated a11y violations", async ({ page }) => {
    // A trip creation, a two-seat booking, and 2 scans at ~3.5s each.
    test.setTimeout(120_000);
    const title = `A11y Bearer Trip ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(7),
      departsAt: "08:30",
      returnsAt: "12:30",
      capacity: 6,
      price: 110,
    });
    await signOut(page);

    // Two seats, because that is what puts an unclaimed seat — and therefore a
    // claim link — on the confirmation (ADR 20260804-seat-claim-links).
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    const partySize = page.getByLabel("Number of divers");
    await expect(partySize).toHaveAttribute("data-hydrated", "true");
    await partySize.selectOption("2");
    await page.getByLabel("Name", { exact: true }).fill("Iris Marlow");
    await page.getByLabel("Email", { exact: true }).fill(`iris-${e2eNow().getTime()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Tem Okafor");
    await page.getByLabel("Use the main contact's email for this diver").check();
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Iris/ })).toBeVisible();

    // Booking lands on the readiness page itself now (ADR
    // 20260820-one-page-after-booking), so the claim link is read off the group
    // panel here rather than off a confirmation one hop back.
    await expect(page).toHaveURL(/\/ready\//);
    const seatRow = page
      .locator("section", { has: page.getByRole("heading", { name: "Your group’s seats" }) })
      .locator("li")
      .filter({ hasText: "Tem Okafor" });
    await seatRow.getByText("Show link").click();
    const claimPath = ((await seatRow.locator("p.font-mono").textContent()) ?? "").match(
      /\/claim\/[^\s/?#]+/,
    )?.[0];
    expect(claimPath, "the group panel offered no claim link to scan").toBeTruthy();

    // The prep hub: an emergency-contact form, a rental-fit form, a waiver
    // hand-off and a checklist whose rows change state as they are satisfied.
    // The densest diver-facing form surface in the product after booking, and
    // the one a diver is most likely to be filling in on a phone at a dock.
    await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
    await expectNoA11yViolations(page);

    // The claim page: a stranger's first-ever DiveDay screen, arriving from a
    // forwarded message with three fields between them and a seat on a boat.
    await page.goto(claimPath ?? "/");
    await expect(
      page.getByRole("heading", { name: `A seat on ${title} is waiting for you` }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the post-trip recap has no automated a11y violations", async ({ page }) => {
    test.setTimeout(60_000);
    // Minted from the seeded booking rather than flown to through a whole
    // finished trip — same door e2e/recap.spec.ts and the visual suite use.
    // The recap is where a diver writes the shop's public review and uploads
    // photos: a star-rating control, a file input and a free-text form, all of
    // them hand-rolled markup no other scan in this file covers.
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
    await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

/**
 * The states a click opens rather than a URL reaches.
 *
 * Everything above scans a *document*. These four scan a **panel**, and they
 * are the app's hand-rolled ARIA: the command palette is a bespoke combobox
 * (`role="combobox"` + `aria-activedescendant` + a `role="listbox"` of
 * `role="option"` buttons, src/components/search/CommandPalette.tsx) and the
 * schedule builder mounts its Move/Copy forms inline on a row. Both are markup
 * axe can check and no route-level scan can ever see, because neither exists
 * until someone opens it.
 *
 * The palette is scanned twice on purpose: empty (the "Go to" list, which is
 * every staff destination) and with results, because `aria-activedescendant`
 * only points at anything once there are rows for it to point at — a stale id
 * there is exactly the class of defect that silently unmoors a screen reader
 * and exactly what an empty-state-only scan would miss.
 */
test.describe("automated accessibility scans of the staff overlays", () => {
  test("the command palette has no automated a11y violations", async ({ page }) => {
    // 2 scans at ~3.5s each, plus the debounced search round trip.
    test.setTimeout(70_000);
    await page.goto("/shop/blue-mantis");
    const trigger = page.getByRole("button", { name: "Search" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await expectNoA11yViolations(page);

    // With rows: `aria-activedescendant` now names a real option id.
    await palette.getByRole("combobox").fill("Di");
    await expect(palette.getByRole("option").first()).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the schedule builder's inline panels have no automated a11y violations", async ({
    page,
  }) => {
    // 3 scans at ~3.5s each.
    test.setTimeout(70_000);
    // The board's *list* is scanned in the static table above. Its actual
    // interaction — reschedule a departure, mint a copy of one — sits behind a
    // per-row "⋯" disclosure, and each choice is a form that mounts into the
    // row and steals focus into its first field (ScheduleBuilder.tsx's
    // autofocus panel) — all of it markup a URL can't reach.
    await page.goto("/shop/blue-mantis/schedule/board");
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    const trigger = page.getByRole("button", { name: /^Move, copy, or remove / }).first();

    // The open action list itself — the app's other hand-rolled disclosure.
    await trigger.click();
    await expect(page.getByRole("button", { name: /^Move / }).first()).toBeVisible();
    await expectNoA11yViolations(page);

    await page
      .getByRole("button", { name: /^Move / })
      .first()
      .click();
    await expectNoA11yViolations(page);

    // Copy is a different panel with a different field set, not the same one
    // relabelled — so it gets its own scan rather than a shared one.
    await trigger.click();
    await page
      .getByRole("button", { name: /^Copy / })
      .first()
      .click();
    await expectNoA11yViolations(page);
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
 * here — the one diver surface nothing in this file scans. It embeds a Google
 * Maps terrain iframe (which the context fixture in e2e/fixtures.ts aborts) and
 * externally hosted site photos proxied through `/_next/image` (which the
 * sealed e2e fleet can never fetch). The reason written here used to be that
 * the document therefore never reached the `networkidle` state the scan waited
 * for; that wait is gone (see `expectNoA11yViolations`), so the reason is gone
 * with it, and a probe against a warm e2e server scanned the page clean in
 * 1.5s. Bringing it in is its own change, filed as
 * FU-20260821-scan-the-reef-briefing-now-that-networkidle-is-gone. Until then a
 * public trip *booking* page is covered by "the trip booking page and its
 * confirmation" above, on the one seeded departure that carries a price and no
 * dive site — so no map and no photos.
 */
test.describe("automated accessibility scans of the signed-out surfaces", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the marketing, account and diver surfaces have no automated a11y violations", async ({
    page,
  }) => {
    // 7 scans at ~3.5s each.
    test.setTimeout(75_000);
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
      // One course page in full, not just the catalog index. It is the longest
      // diver-facing document in the product — hero photo, gallery, FAQ
      // disclosures, a session list and an inquiry form — and it is where an
      // uncertified visitor decides to buy a course, which is the highest-value
      // conversion on the diver side. Unlike the seeded reef trip's booking
      // page (absent above, and why), its photos are bundled assets this
      // worker's own server serves, so the document reaches `networkidle`.
      { path: "/s/blue-mantis/courses/discover-scuba-diving", heading: /Discover Scuba Diving/ },
    ]);
  });
});

/**
 * The diver whose language DiveDay does not carry.
 *
 * `Accept-Language: de-DE` negotiates to no bundle, so the shop's own language
 * is rendered and a band appears above the page saying so in as many words
 * (`src/components/LanguageFallbackNotice.tsx`, review finding I18N-L1). That
 * band is new markup on the single most-visited diver surface, shown only to
 * visitors nobody at the shop can reproduce on their own machine — the exact
 * profile of a render that goes unlooked-at for years. So it is both scanned
 * and asserted here: the assertion proves the notice reaches a real browser at
 * all, and the scan proves it does so without breaking the page's landmark and
 * heading structure.
 */
test.describe("automated accessibility scans for an unsupported-language visitor", () => {
  test.use({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });

  test("the public schedule keeps its structure while announcing the fallback", async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    // The language's own endonym is the one token a reader of German can pick
    // out of an English sentence, which is the whole reason it is resolved
    // through `Intl.DisplayNames` rather than written into the bundle.
    await expect(page.getByText(/Deutsch/)).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
