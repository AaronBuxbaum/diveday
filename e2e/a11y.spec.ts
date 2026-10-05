import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expectNoA11yViolations } from "./a11y-scan";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  choosePartySize,
  counterPath,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openTripFromBoard,
  openTripMore,
  openTripTab,
  STAFF_DAY_HEADING,
  seededTripId,
  sendWaiverForFirstDiver,
  signOut,
  threadStatus,
} from "./helpers";
import { ONBOARD_FORM_PATH } from "./servers";

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
 * - **No dive site**, which rules out every priced reef and wreck charter. Not
 *   because a site cannot be scanned — the reef briefing has its own test
 *   below — but because this scan *books a seat*, and the seeded reef
 *   charter's price and free-seat count are load-bearing for other specs'
 *   "N spots left" text. The one priced charter with no site is the night
 *   dive, and that is the one gated on a specialty.
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

  // The storefront's one dark-scheme scan, on a shop wearing its own colour,
  // is in `storefront-brand.spec.ts`: the canonical demo wears Logbook's
  // tokens since ADR 20261001-logbook, so the branded shop is a minted one,
  // and this file's `signedInAsOwner()` cannot share a context with that.

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
    // A held send counts eight seconds down before it leaves (ADR
    // 20260906-before-you-ask, decision 2); this test sends one, so it takes
    // the slow budget rather than racing the hold against the default.
    test.slow();
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    const waiverHref = await sendWaiverForFirstDiver(page);

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
      .getByRole("navigation", { name: "Departure" })
      .getByRole("link", { name: "Boat" })
      .click();
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    await expectNoA11yViolations(page);

    // The document that leaves the building. One tap from a settled station turns the
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
      .getByRole("navigation", { name: "Departure" })
      .getByRole("link", { name: "Boat" })
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
    // 8 scans at ~3.5s each, plus the sign-in state, first cold render and
    // one board crawl for the counter's departure.
    test.setTimeout(120_000);
    // The counter is a departure's own Divers tab once its arrivals open, so it
    // needs a seeded boat still inside the arrivals window; its <h1> is the
    // trip's title.
    const counterBoat = "Two-Tank Reef — Molasses & French";
    const counter = counterPath(
      "blue-mantis",
      await seededTripId(page, "blue-mantis", counterBoat),
    );
    await scanStaticRoutes(page, [
      // Today, which is now one composition rather than two views of one
      // (ADR 20260827-clearwater-surface-language, decision 4) — so the second
      // scan this list used to carry, of `/blockers`'s by-departure body, is
      // gone with the body. `/blockers` still redirects here, and
      // `day-spine.spec.ts` holds it to a single hop.
      { path: "/shop/blue-mantis", heading: STAFF_DAY_HEADING },
      { path: counter, heading: counterBoat },
      { path: `${counter}/walk-in`, heading: "Walk-in" },
      { path: "/shop/blue-mantis/schedule/board", heading: "Schedule" },
      // Creating a trip is the board's own add panel now (ADR
      // 20260806-one-trip-create-form), and `?add=full` is the deep end of it
      // — the whole former `/trips/new` form, disclosed inline. `/trips/new`
      // itself is a permanent redirect here, so this scans the surface the
      // fields actually live on.
      { path: "/shop/blue-mantis/schedule/board?add=full", heading: "Schedule" },
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
      { path: "/shop/blue-mantis/orders", heading: "Money" },
      { path: "/shop/blue-mantis/orders/new", heading: "New order" },
      { path: "/shop/blue-mantis/promos", heading: "Money" },
      { path: "/shop/blue-mantis/reviews", heading: "Inbox" },
      { path: "/shop/blue-mantis/reports", heading: "Money" },
      { path: "/shop/blue-mantis/staffing", heading: "Schedule" },
      { path: "/shop/blue-mantis/courses", heading: "Courses" },
      { path: "/shop/blue-mantis/waivers", heading: "The release" },
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
      { path: "/shop/blue-mantis/settings", heading: "Settings" },
      { path: "/shop/blue-mantis/settings/team", heading: "Team" },
      { path: "/shop/blue-mantis/settings/import", heading: "Import" },
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

  /**
   * **The remaining typeable staff surfaces** (issue #1056).
   *
   * Seven routes that were photographed on every PR and never scanned — the
   * gear register, the date-request queue, the add-diver form, and the four
   * settings pages the tables above had not reached. Cheap to add: each is a
   * `goto` and an `<h1>`, which is the whole reason the gap survived so long.
   *
   * `/settings/security` and Import's gear tab are both forms a shop
   * fills in once and gets wrong quietly if a field has no label, and the gear
   * register is the densest ledger in the product after the orders index —
   * grouped rows, each carrying its own act (ADR 20260827-the-shops-shelves).
   */
  test("the gear, request and remaining settings surfaces have no automated a11y violations", async ({
    page,
  }) => {
    // 7 scans at ~3.5s each.
    test.setTimeout(95_000);
    await scanStaticRoutes(page, [
      // The register renders at all only because `blue-mantis` seeds gear —
      // the feature is opt-in by presence (ADR 20260815-minimal-gear-register),
      // so an empty shop would scan the empty state instead, which is a
      // different page and not the one worth guarding.
      { path: "/shop/blue-mantis/gear", heading: "Gear" },
      { path: "/shop/blue-mantis/requests", heading: "Inbox" },
      { path: "/shop/blue-mantis/divers/new", heading: "Add a diver" },
      { path: "/shop/blue-mantis/settings/security", heading: "Account security" },
      { path: "/shop/blue-mantis/settings/integrations", heading: "Shop integrations" },
      {
        path: "/shop/blue-mantis/settings/safety-checklist",
        heading: "Pre-departure checklist",
      },
      { path: "/shop/blue-mantis/settings/import?what=gear", heading: "Import" },
      { path: "/shop/blue-mantis/settings/import?what=dive-sites", heading: "Import" },
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

    // Trip: the departure's compact definition and working roster.
    await expect(page.getByRole("heading", { level: 1, name: REEF_TRIP })).toBeVisible();
    await expectNoA11yViolations(page);

    // The Trip surface carries the roster. It is the single densest staff
    // surface there is — a per-diver waiver control, an add-a-diver form, and
    // a readiness chip per row. The existing waiver scan passes *through* this
    // page on its way to a bearer link and never scans it.
    await openTripTab(page, "Trip");
    await expect(page.locator("#roster")).toBeVisible();
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
    await openTripTab(page, "Trip");
    await expect(page.locator("#roster")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the global add-a-booking door has no automated a11y violations", async ({ page }) => {
    // 5 scans at ~3.5s each, plus a board crawl and a server-action round trip.
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

    // The desk phone's answer (N-22) at the foot of the same page, opened by
    // its `#call` hash, on the branch that renders its extra block: the
    // inactive branch is a `disabled` fieldset that stays in the DOM, so this
    // scan sees the whole form either way.
    await page.goto("/shop/blue-mantis/bookings/new?outcome=date-request#call", {
      waitUntil: "domcontentloaded",
    });
    const call = page.locator("details#call");
    await expect(call.getByLabel("What they asked about")).toBeVisible();
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

    // The signature log with one record open: the disclosure's own contents —
    // the doors and any flagged medical prompt — are markup nothing scans while
    // every row is shut, and this is a legal record a shop is expected to be
    // able to read back. It shares `/waivers` now (ADR
    // 20260827-people-not-lists), whose closed state the static table above
    // already scans.
    await page.goto("/shop/blue-mantis/waivers", { waitUntil: "domcontentloaded" });
    await page.locator('details[id^="waiver-record-"]').first().locator("summary").click();
    await expect(page.locator('details[id^="waiver-record-"][open]').first()).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("the catalog editors have no automated a11y violations", async ({ page }) => {
    // 6 scans at ~3.5s each.
    test.setTimeout(90_000);
    // The staff roster first — one ledger, an `<h2>` per agency over the run it
    // describes, with every ladder on one pager (ADR 20260827-the-shops-shelves,
    // slice 9g). The agency tab strip it replaced is gone, so a group heading is
    // what proves the rows are in the DOM before axe reads them.
    await page.goto("/shop/blue-mantis/courses", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "PADI" })).toBeVisible();
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

  test("the home's evening reading has no automated a11y violations", async ({ page, request }) => {
    // 1 scan at ~3.5s, plus the seed.
    test.setTimeout(40_000);
    // The evening is a *state of the shop home* rather than a page of its own
    // (ADR 20260827-clearwater-surface-language, decision 4). The static route
    // table reaches the home in its morning reading; this is the DOM that only
    // exists once every station has settled — the settled stations with their
    // marks and the day's takings. `seed-evening` moves the day's boats behind
    // the frozen clock, which is process-wide and cannot be moved per test.
    await request.post("/api/test/seed-evening");
    await page.goto("/shop/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("region", { name: "What today made" }),
      "/shop/blue-mantis never rendered its evening",
    ).toBeVisible();
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
    await openTripMore(page);
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
 * **The paper day** — the one staff surface that renders another surface more
 * than once.
 *
 * `/shop/<slug>/print` (N-54) composes the trip manifest and the prep list once
 * per departure of today. Every fixed element id inside those two pages is
 * therefore emitted N times, and a duplicate id does not fail loudly: each
 * `aria-labelledby` and each `#roll-call-list` jump in departures 2..N silently
 * resolves to **departure 1's** element, so a screen-reader user running roll
 * call on the third boat is read the first boat's heading over the third boat's
 * divers. Nothing else in this suite can see that — which is exactly why the
 * duplicate-id check inside `expectNoA11yViolations` is the assertion this
 * route is here for. `src/lib/element-id.ts` is the fix it guards.
 */
test.describe("automated accessibility scans of the paper day", () => {
  test("the day packet scans clean and repeats no element id across departures", async ({
    page,
  }) => {
    // The slowest staff render in the app: the manifest and prep readers run
    // once per departure of today. Sized like the other composed scans rather
    // than the 15s default.
    test.setTimeout(120_000);
    await page.goto("/shop/blue-mantis/print", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Day packet" }),
      "/shop/blue-mantis/print never rendered its <h1>",
    ).toBeVisible();
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
    await choosePartySize(page, 2);
    await page.getByLabel("Name", { exact: true }).fill("Iris Marlow");
    await page.getByLabel("Email", { exact: true }).fill(`iris-${e2eNow().getTime()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Tem Okafor");
    await page.getByLabel("Use the main contact’s email for this diver").check();
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
    await expect(threadStatus(page)).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
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
 * **Reduced motion rides the context beside it** (#1940). Two of the three
 * scans below opened with `page.emulateMedia({ reducedMotion: "reduce" })`,
 * which is a CDP message to a page that already exists: the document the
 * `goto` after it creates can resolve its style before the message lands, and
 * then the scan measures a colour mid-fade — the exact race those two are
 * here to stop. `test.use` bakes the preference into the browser context
 * before any page exists, so it cannot lose.
 *
 * The third scan (the reef briefing) inherits it, which is a deliberate
 * widening rather than spillage: it asks for no animated state, and settled
 * colour is what every scan in this file is meant to be measuring. Scoping it
 * away would cost a nested block and one level of indentation over a hundred
 * and forty lines to say nothing.
 */
test.describe("automated accessibility scans of the signed-out surfaces", () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" });

  test("the marketing, account and diver surfaces have no automated a11y violations", async ({
    page,
  }) => {
    // 8 scans at ~3.5s each.
    test.setTimeout(80_000);
    // **The same reduced-motion state its sibling block scans in**, and for the
    // identical reason -- `/` is in both lists, and the hero's roll-call rows
    // are the thing being raced. The marketing-pages scan below explains the
    // mechanism in full; this block scanned the same landing page without it
    // and passed on timing alone until a run caught the fade at 3.89:1 and
    // 2.89:1 (the second row is 120ms behind the first, so it is measured
    // paler still). Settled, `--success` on the card is over the 4.5 floor.
    // It comes from this block's `test.use` now, not from a call here (#1940).
    await scanStaticRoutes(page, [
      // The landing page and the two account-lifecycle forms. Each renders a
      // single `<h1>`, so matching any non-empty one is enough and keeps this
      // table from re-stating marketing copy that is meant to change.
      { path: "/", heading: /\S/ },
      { path: "/sign-in", heading: /\S/ },
      { path: "/onboard", heading: /\S/ },
      // The same route with the setup key is the form itself; without it,
      // the closed door above.
      { path: ONBOARD_FORM_PATH, heading: /\S/ },
      // **A door that has closed** (issue #1123). Every route above is one a
      // person walks *through*, and `EntryDone` is a different composition
      // entirely — a decorative drawn mark in a circle, an `<h1>`, one muted
      // paragraph, one quiet link, and no form at all. Slice 10a made it the
      // app's one warm terminal pattern, so it is now what a person meets on a
      // dead waiver link, a spent invite, a used reset token, a finished
      // unsubscribe and a verified email; nothing ran axe over any of them.
      //
      // An unparseable token is the cheapest reachable instance: no fixture,
      // no seeded row, no sign-in. One door, not five — the five are one
      // composition wearing different words, so the marginal scan buys copy
      // rather than structure and costs twenty seconds a run.
      { path: "/verify/not-a-real-token", heading: /isn’t available/ },
    ]);

    // The diver-facing shop. Its `<h1>` is served in the static shell while
    // the departure list streams, so this waits on the list itself — the same
    // race the "public schedule" scan at the top of this file documents.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    await expectNoA11yViolations(page);

    await scanStaticRoutes(page, [
      { path: "/s/blue-mantis/courses", heading: "Courses" },
      // One course page in full, not just the catalog index. It is the second
      // longest diver-facing document in the product — hero photo, gallery, FAQ
      // disclosures, a session list and an inquiry form — and it is where an
      // uncertified visitor decides to buy a course, which is the highest-value
      // conversion on the diver side. The longest is the reef briefing, scanned
      // in its own test below.
      { path: "/s/blue-mantis/courses/discover-scuba-diving", heading: /Discover Scuba Diving/ },
      // The shop's own 404 (issue #765). A diver reaches it by tapping a link
      // that has outlived its departure, so it is a first impression rather
      // than an edge case — and it is the one page in this namespace whose
      // whole content is a heading and a single link.
      {
        path: "/s/blue-mantis/trips/00000000-0000-4000-8000-000000000000",
        heading: "That page isn’t here any more",
      },
    ]);
  });

  /**
   * **The rest of the marketing tree** (issue #1056).
   *
   * Twelve routes a buyer reads before they ever sign up, every one of them
   * photographed on every PR and none of them scanned when this was written. They are the cheapest
   * scans in the file — no sign-in, no fixture, no navigation — and the
   * likeliest place for a contrast mistake to survive, because marketing pages
   * are where a tinted callout or a muted caption gets written by hand.
   *
   * Headings are matched as "any non-empty `<h1>`" rather than by text: this
   * table would otherwise re-state marketing copy that is meant to change, and
   * `scanStaticRoutes` already fails loudly when a page renders no `<h1>` at
   * all — which is itself the a11y defect worth catching here.
   */
  test("the marketing and switching pages have no automated a11y violations", async ({ page }) => {
    // 12 scans at ~3.5s each, plus the first cold render.
    test.setTimeout(105_000);
    // **Scanned with the app's own reduced-motion state**, which is not a way
    // of avoiding an awkward answer: the hero's roll-call rows enter with
    // `marketing-roll-call-settle`, a 360ms fade from `opacity: 0.72`, and a
    // scan that lands mid-fade measures the composited green at 4.16:1 — under
    // the 4.5 floor for 12px text, while the settled colour is 5.0:1 and
    // passes. That is a race, not a defect, and the repo refuses to answer a
    // race with a wait (`pnpm check:e2e-hygiene`). `prefers-reduced-motion`
    // resolves it deterministically *through the product*: globals.css pins
    // those rows to `animation: none; opacity: 1`, which is the state every
    // reader ends at and the one worth holding to the contrast rule.
    //
    // It is set on this block's `test.use` rather than here, because a call on
    // a live page races the `goto` it is meant to precede (#1940).
    await scanStaticRoutes(page, [
      { path: "/product", heading: /\S/ },
      { path: "/pricing", heading: /\S/ },
      { path: "/about", heading: /\S/ },
      { path: "/terms", heading: /\S/ },
      { path: "/privacy", heading: /\S/ },
      // The one page here whose meaning is carried by a coloured mark, so the
      // one where a contrast miss would cost a reader the answer rather than
      // the polish.
      { path: "/status", heading: /\S/ },
      // The switching hub, one competitor guide, and the spreadsheet guide —
      // three different compositions rather than three copies of one.
      { path: "/switching", heading: /\S/ },
      { path: "/switching/eve", heading: /\S/ },
      { path: "/switching/spreadsheet", heading: /\S/ },
      // Two feature pages: one template, so two drawings rather than twelve
      // copies of it — a phone screen and a staff panel.
      { path: "/product/waivers", heading: /\S/ },
      { path: "/product/rental-gear", heading: /\S/ },
      // The last signed-out account form. Its two siblings (`/sign-in`,
      // `/onboard`) are scanned above; this one is reached by somebody who is
      // already locked out, which is the worst moment to meet a form a screen
      // reader cannot label.
      { path: "/forgot-password", heading: /\S/ },
    ]);
  });

  /**
   * The richest document a diver ever sees, and until now the one surface in
   * this file nothing scanned: a dive plan, a site briefing, a field guide of
   * marine life, an embedded map and a booking form, on one page.
   *
   * It was left out because the scan used to wait for `networkidle`, which this
   * page never reached — `e2e/fixtures.ts` aborted its Google Maps iframe, and
   * its dive-site photos are externally hosted and proxied through
   * `/_next/image`, which the sealed e2e fleet cannot fetch. That wait was
   * removed from `expectNoA11yViolations` in PR #585 and every caller now gates
   * on the surface's own heading, so the reason went with it (issue #619).
   *
   * Neither of those two blocks axe, and neither may be answered by putting the
   * wait back (`pnpm check:e2e-hygiene` refuses it) or by narrowing the scan.
   * A violation here is a real defect to fix in `src/app`.
   *
   * Its own test rather than a leg of the booking scan: the cost is one
   * navigation, not shared setup, and the booking scan books a seat — which
   * this page's departure cannot spare, since its free-seat count is what other
   * specs read as "N spots left".
   */
  test("the reef briefing has no automated a11y violations", async ({ page }) => {
    // Two page loads and one scan; the scan itself measured ~1.5s against a
    // warm server, and the budget is for the navigations around it.
    test.setTimeout(45_000);
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("list", { name: "Upcoming trips" })).toBeVisible();
    // Reached the way a diver reaches it. The row's accessible name carries the
    // seat count — "<title> · N spots left" — so this matches a fragment of the
    // title rather than the whole name, which would go stale the moment a seat
    // sells.
    await page
      .getByRole("link", { name: /Benwood & Elbow/ })
      .first()
      .click();
    // The page's own heading, never a skeleton: this route streams its body
    // behind a static shell like every other (ADR 20260804-instant-navigation).
    await expect(page.getByRole("heading", { level: 1, name: /Benwood & Elbow/ })).toBeVisible();
    await expectNoA11yViolations(page);
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

/**
 * **The 44px floor, measured rather than eyeballed.**
 *
 * `docs/design/principles.md` §2 sets it: "Primary flows work one-handed on a
 * phone, in glare, with wet fingers: touch targets ≥ 44 px". Nothing enforced
 * it. Axe's `target-size` is not among the rules this file enables, and a
 * screenshot cannot tell 18px from 44px — so three staff tables shipped their
 * row-opening links as an 18px word, 34 of them on the gear register, which a
 * shop owner taps standing at the wall tagging cylinders (issue #786).
 *
 * **What this measures is the element's own box**, which is the same thing axe
 * measures and the same thing a thumb meets — and it is deliberately not the
 * hit area a pseudo-element might extend. That distinction is the whole reason
 * the defect survived: `DiverList` was believed to stretch its row link across
 * the `<tr>` with `after:inset-0`, and `Td`'s `overflow-hidden` clips that to
 * the cell, so the "fix" everyone pointed at was never doing what its comment
 * said. A rule that trusted the overlay would have gone on passing.
 *
 * Two exemptions, both genuine, and neither a class of control:
 *
 * - **The skip links**, which report 1x1 because they are positioned offscreen
 *   until focused. They are a keyboard affordance and never a tap target.
 * - **An `<input>` inside a `<label>` that meets the floor itself** — a
 *   checkbox is 16px by convention and its label is the target; the public
 *   schedule's "Has space" filter is 91x44 with a 16px box inside it.
 *
 * Inline prose links are not exempted here because none of these surfaces has
 * one. If a page grows one, exempt it by name with a sentence — never by
 * widening the rule.
 */
const TAP_TARGET_PAGES: readonly { name: string; path: (page: Page) => Promise<string> }[] = [
  { name: "/shop/blue-mantis/gear", path: async () => "/shop/blue-mantis/gear" },
  { name: "/shop/blue-mantis/orders", path: async () => "/shop/blue-mantis/orders" },
  {
    name: "a departure's Divers tab with the desk open",
    path: async (page) =>
      counterPath(
        "blue-mantis",
        await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French"),
      ),
  },
];

test.describe("tap targets on a phone", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 } });

  for (const target of TAP_TARGET_PAGES) {
    test(`every control on ${target.name} clears the 44px floor`, async ({ page }) => {
      await page.goto(await target.path(page));
      // The page's own first control, so this waits on the thing under test
      // rather than on a duration.
      await page.locator("main a, main button").first().waitFor();

      const undersized = await page.evaluate(() => {
        const isSkipLink = (element: Element) =>
          element.tagName === "A" && (element.textContent ?? "").startsWith("Skip to");
        const labelCoversIt = (element: Element) => {
          if (element.tagName !== "INPUT") return false;
          const label = element.closest("label");
          return Boolean(label && label.getBoundingClientRect().height >= 44);
        };
        // A target stretched by an absolute `::after` (the counter queue's name
        // door: a 28px line, `after:-inset-y-2`) is as tall as that pseudo-box,
        // which is what a finger meets and what the pixel probe's `hitBox` reads.
        const afterCoversIt = (element: Element) => {
          const after = getComputedStyle(element, "::after");
          if (after.position !== "absolute") return false;
          const height =
            element.getBoundingClientRect().height -
            (Number.parseFloat(after.top) || 0) -
            (Number.parseFloat(after.bottom) || 0);
          return height >= 44;
        };
        return [...document.querySelectorAll("a, button, input, summary")]
          .filter((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (style.display === "none" || style.visibility === "hidden") return false;
            if (box.width === 0 || box.height >= 44) return false;
            return !isSkipLink(element) && !labelCoversIt(element) && !afterCoversIt(element);
          })
          .map((element) => {
            const box = element.getBoundingClientRect();
            // Named, not counted: "34" sends the next reader hunting.
            return `${element.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)} "${(element.textContent ?? "").trim().slice(0, 24)}"`;
          });
      });

      expect(undersized).toEqual([]);
    });
  }
});
