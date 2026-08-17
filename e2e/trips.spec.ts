import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openRosterDetails,
  seededTripId,
} from "./helpers";

test("the public schedule lists seeded trips with capacity states, a month rail, and per-dive briefings", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  // Scoped to the departure's own card heading: the reviews section below the
  // list quotes trip titles too, so a bare text match finds two things.
  await expect(
    page.getByRole("heading", { level: 2, name: "Two-Tank Reef — Molasses & French" }),
  ).toBeVisible();
  // Assert the count rather than visibility: a capacity badge can double-render
  // for a sub-frame during hydration, and Playwright throws strict-mode
  // violations immediately without retrying — so an unscoped `toBeVisible` here
  // flakes under load. `toHaveCount(1)` retries until the DOM settles, yet still
  // fails loudly if two trips ever genuinely show the same capacity. Scoped to
  // the trip list itself: the "Next departure" card above it repeats whichever
  // trip's capacity it names, so a page-wide match legitimately finds two.
  const tripList = page.getByRole("list", { name: "Upcoming trips" });
  await expect(tripList.getByText("3 spots left")).toHaveCount(1); // 9 of 12 booked
  await expect(tripList.getByText("Full")).toHaveCount(1); // sold-out wreck trip
  await expect(page.getByRole("link", { name: "Full trip form" })).toHaveCount(0);
  await expect(page.getByLabel("Schedule overview")).toHaveCount(0);
  await expect(page.getByText(/reserve your spot/i)).toBeVisible();

  // The month rail names the month in view and steps the list a month at a
  // time — what the old full month grid did for a diver, in one quiet row.
  // A labeled region, not a `<nav>` landmark — the embed promises zero
  // navigation landmarks inside the iframe (e2e/schedule-embed.spec.ts).
  const monthNav = page.getByRole("region", { name: "Browse by month" });
  await expect(monthNav).toBeVisible();
  // The rail defaults to the first upcoming departure's month, and the server
  // clock is frozen (E2E_FROZEN_CLOCK), so its label's year is whatever year
  // that instant falls in — read it from the same source rather than the real
  // wall clock, which would diverge once real time passes the frozen year.
  const currentYear = e2eNow().getUTCFullYear();
  await expect(monthNav.getByText(new RegExp(`\\b${currentYear}\\b`))).toBeVisible();
  // The seed schedules departures into next month, so the rail offers it.
  await expect(monthNav.getByRole("link", { name: "Next month" })).toBeVisible();

  // The card names *every* site the departure visits, not just dive one's.
  // Reading `trips.dive_site_id` here is what made a two-site day look like
  // "one dive site, two dive briefings" (glossary: Dive site / Dive briefing).
  const twoSiteCard = tripList
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" });
  await expect(twoSiteCard.getByText(/^Dive sites · Molasses Reef and French Reef$/)).toHaveCount(
    1,
  );
  // And a departure whose second tank has no site yet says so, in the same
  // line, rather than silently reporting one site for a two-tank plan.
  const openTankCard = tripList
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Benwood & Elbow" });
  await expect(
    openTankCard.getByText(/^Dive site · Benwood Wreck · 1 more dive to be confirmed$/),
  ).toHaveCount(1);

  // A multi-dive trip's public page presents every dive briefing.
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await expect(page.getByRole("heading", { name: "Your two-tank plan" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Dive 1$/ })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Dive 2$/ })).toBeVisible();
  await expect(page.getByText("French Reef is the second tank")).toBeVisible();
});

/**
 * The count a shop owner asked about: "a two-tank dive with one dive site and
 * two dive briefings". There is one briefing per *planned dive* and one site per
 * dive that has one — so the two counts differ whenever a tank's site is still
 * open, and the tank without one has to say so on its own card.
 */
test("a tank with no site yet says so on the booking page, so one site and two dives read as a plan", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Benwood & Elbow" })
    .getByRole("link", { name: "Two-Tank Reef — Benwood & Elbow" })
    .click();
  await expect(page.getByRole("heading", { name: "Your two-tank plan" })).toBeVisible();
  // Tank one has a site; tank two is the crew's call at the dock.
  await expect(page.getByRole("heading", { level: 3, name: "Benwood Wreck" })).toBeVisible();
  await expect(page.getByText("Site to be confirmed")).toHaveCount(1);
});

/**
 * DOM-M3's picker (ADR 20260803-per-trip-crew-role, review 20260803 D5).
 * Until this control shipped, nothing in the app wrote
 * `trip_assignments.trip_role` except the seed — so the
 * divemaster-rostered-as-captain over-count the column exists to fix was still
 * live at every real shop while the docs stated the fixed behaviour as fact.
 */
test.describe("per-trip crew role", () => {
  signedInAsOwner();

  test("staff set the job a crew member is doing on one sailing, and it survives a reload", async ({
    page,
  }) => {
    // Creating the departure, paging the board to it, one assign, three role
    // writes and two reloads — each a full server round trip, well past the
    // default per-test budget (same reason the crew checkpoint test in
    // e2e/manifest.spec.ts raises its own).
    test.setTimeout(60_000);
    // Its own departure, so a crew edit here can never pull a seeded charter's
    // crew count out from under the manifest spec running in parallel.
    const title = `Crew role charter ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(21),
      departsAt: "08:00",
      returnsAt: "12:00",
    });
    // Read the card's href rather than clicking it: the board streams in, so
    // reading `page.url()` after a click races that render.
    const link = await findTripOnBoard(page, "blue-mantis", title);
    const href = await link.getAttribute("href");
    if (!href) throw new Error(`no trip card found for ${title}`);
    await page.goto(href);

    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Keiko Tanaka" });
    await expect(page.getByRole("button", { name: "Unassign Keiko Tanaka" })).toBeVisible();

    const picker = page.getByLabel("Job Keiko Tanaka is doing on this trip");
    await picker.selectOption("captain");
    await expect(picker).toHaveValue("captain");

    // It is a write, not a client-side toggle: the ratio reads this column.
    await page.reload();
    await expect(page.getByLabel("Job Keiko Tanaka is doing on this trip")).toHaveValue("captain");

    // And "not specified" is reachable again — it is the honest default, not a
    // safety claim, and clearing it must never need SQL.
    await page.getByLabel("Job Keiko Tanaka is doing on this trip").selectOption("");
    // The select is controlled and only re-renders once the server accepted the
    // write (CrewSection's confirm-then-render discipline), so this settles only
    // after persistence. Without it the reload races the server action and reads
    // the old role back — the captain step above already waits the same way.
    await expect(page.getByLabel("Job Keiko Tanaka is doing on this trip")).toHaveValue("");
    await page.reload();
    await expect(page.getByLabel("Job Keiko Tanaka is doing on this trip")).toHaveValue("");
  });
});

/**
 * The pulse: a trip's Overview opens with the state of the boat — seats in
 * words and numbers, then only the facts that need someone, each one a link
 * to the surface that fixes it (design principle 10). The seeded reef trip
 * carries one blocked diver (an unsent waiver) and several rental-fit gaps,
 * so both facts render; the seat caption owns the numbers, so the header's
 * "spots left" pill stands down on this tab (principle 9 — one fact, once).
 */
test.describe("trip pulse", () => {
  signedInAsOwner();

  test("the Overview answers how the boat stands, and the blocked fact lands on the filtered roster", async ({
    page,
  }) => {
    const link = await findTripOnBoard(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    const href = await link.getAttribute("href");
    if (!href) throw new Error("no trip card found for the seeded reef trip");
    await page.goto(href);

    // The caption carries the numbers the bar draws — and because it does,
    // the capacity pill must not repeat them above it.
    await expect(page.getByText("9 of 12 booked · 3 seats open")).toBeVisible();
    await expect(page.getByText("3 spots left")).toHaveCount(0);

    // Each fact is a door to its fix: the blocked one lands on the Guests
    // roster already narrowed to the divers who hold the boat up.
    await expect(page.getByRole("link", { name: /missing rental sizes/ })).toBeVisible();
    await page.getByRole("link", { name: /can’t board yet/ }).click();
    await expect(page).toHaveURL(/rf=blocked/);
    // The chip row confirms the filter is on and counts the same one diver.
    await expect(page.getByRole("link", { name: "Blocked (1)" })).toBeVisible();
    // Role-scoped: the card renders her name twice (heading and record link).
    await expect(page.getByRole("link", { name: "Priya Sharma" })).toBeVisible();
  });

  test("the money fact's link opens an Orders index narrowed to that one departure", async ({
    page,
  }) => {
    const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");

    // Unfiltered — every open invoice the shop is carrying, which is what the
    // pulse's link used to land on. The table's presence is the barrier: rows
    // and the filter line stream in together, and `count()` never auto-waits.
    await page.goto("/shop/blue-mantis/orders?status=open&range=all");
    const rows = page.locator("tbody tr");
    await expect(page.getByRole("table")).toBeVisible();
    const shopWide = await rows.count();
    expect(shopWide).toBeGreaterThan(1);

    // Clicked on the Overview rather than reconstructed, now that the seed puts
    // one open invoice on this departure (src/db/seed-open-invoice.ts). The
    // difference matters: reconstructing the URL only ever proved the URL, and
    // would have kept passing if the fact stopped rendering at all.
    await page.goto(`/shop/blue-mantis/trips/${tripId}`);
    await page.getByRole("link", { name: /awaiting payment/ }).click();
    await expect(page).toHaveURL(new RegExp(`tripId=${tripId}`));
    // Narrowed, and it says so with the departure's own name rather than
    // leaving a staffer to wonder which boat an empty list is about.
    await expect(
      page.getByText("Showing orders for Two-Tank Reef — Molasses & French."),
    ).toBeVisible();
    expect(await rows.count()).toBeLessThan(shopWide);
    // The way back to the departure, and the way back out of the filter.
    await expect(page.getByRole("link", { name: "Open the departure" })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${tripId}`,
    );
    await expect(page.getByRole("link", { name: "Clear filters" }).first()).toBeVisible();

    // Applying another filter keeps the departure: the form carries it, so a
    // staffer narrowing by date does not silently widen back to every boat.
    await page.getByLabel("From").fill("2020-01-01");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`tripId=${tripId}`));
    await expect(
      page.getByText("Showing orders for Two-Tank Reef — Molasses & French."),
    ).toBeVisible();
  });
});

test.describe("trip print packet", () => {
  signedInAsOwner();

  test("the Overview opens a complete printable trip packet", async ({ page }) => {
    const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/blue-mantis/trips/${tripId}`);
    await expect(page.getByRole("button", { name: "Print / save PDF" })).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Print / save PDF" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(new RegExp(`/shop/blue-mantis/trips/${tripId}/print$`));
    await expect(popup.getByRole("heading", { name: "Trip packet" })).toBeVisible();
    await expect(popup.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Guests", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Manifest", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Prep", exact: true })).toHaveCount(1);
    await popup.close();

    // Printing is intentionally owned by Overall. The packet is the one
    // document door; the other tabs must not quietly print only themselves.
    for (const tab of ["guests", "manifest", "prep"]) {
      await page.goto(`/shop/blue-mantis/trips/${tripId}/${tab}`);
      await expect(page.getByRole("button", { name: "Print / save PDF" })).toHaveCount(0);
    }
  });
});

/**
 * The undo of a roster removal is a *stale* affordance by construction: the
 * banner is server-rendered from `?notice=booking-removed&bid=…` and then
 * `FlashParams` strips those params, so the button sits on screen for as long
 * as staff leave the page open while the world moves on around it. One of the
 * three ways it can be refused is the trip itself being cancelled out from
 * under the roster — and unlike a taken seat, no wait list helps, so it gets
 * its own words: reinstate the trip first.
 *
 * `src/db/bookings.test.ts` pins the outcome (`restoreBooking` → "trip_cancelled",
 * the row stays cancelled, and the undo takes once the trip is reinstated).
 * What that cannot see is whether staff are *told*, so this drives the real
 * screen: remove, cancel the trip in another window, then press the undo that
 * is still sitting there.
 */
test.describe("undoing a removal after the trip is cancelled", () => {
  signedInAsOwner();

  test("the stale undo refuses with the reinstate-first banner instead of re-seating a diver", async ({
    page,
  }) => {
    // Create the departure, page the board to it, add a diver, remove them,
    // cancel the trip on a second page, then press undo — seven server round
    // trips, well past the suite's 15s single-flow default.
    test.setTimeout(60_000);
    const title = `Undo refusal charter ${e2eNow().getTime()}`;
    const diver = "Ursula Vance";

    await createTrip(page, {
      title,
      date: daysFromNow(6),
      departsAt: "09:00",
      returnsAt: "13:00",
      capacity: 6,
    });

    // Read the card's href rather than clicking it: the board streams in, so
    // reading `page.url()` after a click races that render.
    const link = await findTripOnBoard(page, "blue-mantis", title);
    const tripPath = await link.getAttribute("href");
    if (!tripPath) throw new Error(`no trip card found for ${title}`);

    await page.goto(`${tripPath}/guests`);
    const addDiver = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Add a diver" }) })
      .filter({ visible: true });
    await addDiver.getByLabel("Name").filter({ visible: true }).fill(diver);
    await addDiver
      .getByLabel("Email")
      .filter({ visible: true })
      .fill(`ursula-${e2eNow().getTime()}@example.com`);
    await addDiver.getByRole("button", { name: "Add to trip" }).click();
    // Prefix match: with no email provider configured the fleet gets the
    // honest "…but their waiver wasn't emailed" variant of this notice.
    await expect(page.getByRole("status")).toContainText("Diver added to the trip");

    // A cancel inside a refund window moves real money, so the removal keeps
    // its blocking two-tap confirm (InlineConfirm) rather than landing behind
    // an undo toast.
    const row = page.locator("#roster li").filter({ hasText: diver }).filter({ visible: true });
    // The confirm is a client component: an arm-tap before hydration is a
    // native click with no handler, so the "Yes" step never appears. Retry the
    // arm until the confirm actually renders instead of trusting one tap.
    await expect(async () => {
      await openRosterDetails(row);
      await row.getByRole("button", { name: "Remove booking" }).click();
      await expect(row.getByRole("button", { name: "Yes, remove booking" })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass();
    await row.getByRole("button", { name: "Yes, remove booking" }).click();
    const removedNotice = page.getByRole("status").filter({ hasText: "Booking cancelled" });
    await expect(removedNotice).toContainText("Booking cancelled — the spot is open again.");
    const undo = removedNotice.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    // Meanwhile, in another window, the crew stands the trip down — the
    // weather go/no-go call, open to any staff member. This page never
    // reloads, so its undo button is now pointing at a cancelled departure,
    // exactly the state a real front desk hits.
    const other = makeActivitySafe(await page.context().newPage());
    try {
      await other.goto(tripPath);
      await other.getByRole("button", { name: "Cancel trip" }).click();
      await expect(other.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
    } finally {
      await other.close();
    }

    await undo.click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't undo" })).toContainText(
      "Couldn't undo — this trip has been cancelled. Reinstate the trip first, then add them back.",
    );
    // Refused, not partially applied: the diver is still off the roster.
    await expect(page.getByRole("link", { name: diver })).toHaveCount(0);
  });
});
