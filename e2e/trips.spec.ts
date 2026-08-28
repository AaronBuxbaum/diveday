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
  // The shopfront leads with the shop (ADR
  // 20260827-clearwater-surface-language, decision 8); "Schedule" is the week's
  // own section heading beneath it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blue Mantis Divers");
  await expect(page.getByRole("heading", { level: 2, name: "Schedule" })).toBeVisible();
  // Scoped to the departure's own row heading: the reviews shelf below the list
  // quotes trip titles too, so a bare text match finds two things.
  await expect(
    page.getByRole("heading", { level: 3, name: "Two-Tank Reef — Molasses & French" }),
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
  // The hero says only what the shop wrote. DiveDay's own "find your next day
  // on the water, … reserve your spot" filler left the page with the
  // recomposition; it survives as the metadata description and nowhere else.
  await expect(page.getByText(/reserve your spot/i)).toHaveCount(0);
  await expect(page.getByText("Small-boat reef and wreck diving out of Key Largo.")).toBeVisible();

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
  await expect(twoSiteCard.getByText(/^Molasses Reef and French Reef$/)).toHaveCount(1);
  // And a departure whose second tank has no site yet says so, in the same
  // line, rather than silently reporting one site for a two-tank plan.
  const openTankCard = tripList
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Benwood & Elbow" });
  await expect(openTankCard.getByText(/^Benwood Wreck · \+ 1 more dive site$/)).toHaveCount(1);

  // A multi-dive trip's public page presents every dive briefing.
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  // The pitch, above the form: the run of dives in plan order (ADR
  // 20260827-the-divers-thread, decision 2). The swipeable briefing deck this
  // replaced is `/ready`'s now — reading for the night before, not the pitch.
  await expect(page.getByRole("heading", { name: "The day" })).toBeVisible();
  await expect(page.getByText("Dive 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Dive 2", { exact: true })).toBeVisible();
  await expect(page.getByText("French Reef", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "The day" })).toBeVisible();
  // Tank one has a site; tank two is the crew's call at the dock.
  await expect(page.getByText("Benwood Wreck", { exact: true })).toBeVisible();
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
    await expect(page.getByRole("table").first()).toBeVisible();
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
    // **Three sections, not four.** The packet stopped composing the two tabs
    // that are working pages rather than documents (issue #814): Overview *is*
    // the trip's edit form, and Guests is all actions — send a waiver, remove a
    // booking — none of which can happen on paper. Their facts are not lost:
    // the dive plan that only ever lived inside Overview's form is rendered as
    // words in "Dives", and the roster Guests showed is the manifest's, already
    // read-only and already carrying each diver's emergency contact.
    await expect(popup.getByRole("heading", { name: "Dives", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Manifest", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Prep", exact: true })).toHaveCount(1);
    await expect(popup.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(0);
    await expect(popup.getByRole("heading", { name: "Guests", exact: true })).toHaveCount(0);
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
    await page.getByRole("link", { name: "Add diver" }).click();
    await page.waitForURL(/\/divers\/new/);
    await page.getByLabel("Full name").fill(diver);
    await page.getByLabel("Email").fill(`ursula-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: "Add to trip" }).click();
    await page.waitForURL(/\/trips\/[^/]+\/guests/);
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

/**
 * **No control on a departure page may need a sideways gesture on a phone.**
 *
 * The four-tab strip under the shop header is how a crew member gets from the
 * roster to the roll call, on a phone, on a boat — `docs/design/principles.md`
 * §2's conditions exactly. It was three pixels too wide for a 390px viewport in
 * English, which is enough to clip "Prep" by a hair and to make the whole bar
 * drag sideways and spring back under a thumb that meant to scroll the page.
 * In Spanish it was ninety-six pixels too wide, so a whole tab was simply out
 * of sight for every Spanish-speaking shop (issue #811).
 *
 * **Nothing could have caught it.** The visual suite compares rendered pixels,
 * and a three-pixel scrollable strip is pixel-identical to a three-pixel
 * clipped one; you only find this by asking the DOM. So this asks the DOM, in
 * both shipped locales, because the English measurement was the reassuring one
 * and the Spanish measurement was the real bug.
 */
async function overflowingControls(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("nav")]
      .filter((nav) => nav.className.includes("rounded-2xl") && nav.className.includes("gap-1"))
      .map((nav) => ({
        label: nav.getAttribute("aria-label"),
        overflow: nav.scrollWidth - nav.clientWidth,
        text: (nav.textContent ?? "").replace(/\s+/g, " ").trim(),
      }))
      .filter((row) => row.overflow > 0),
  );
}

/** Every departure sub-page, measured at the narrowest viewport we design for. */
async function assertNoSidewaysScroll(page: import("@playwright/test").Page, tripPath: string) {
  await page.setViewportSize({ width: 390, height: 900 });
  for (const suffix of ["", "/guests", "/manifest", "/prep"]) {
    await page.goto(`${tripPath}${suffix}`);
    // The segmented track itself, not the first `nav` on the page — that one
    // is the shop header's, which is hidden at this width. Waiting for the
    // thing under test is what makes this deterministic rather than timed.
    await page.locator('nav[class*="rounded-2xl"]').first().waitFor();
    expect(await overflowingControls(page), `${suffix || "/overview"}`).toEqual([]);
  }
}

test.describe("a departure's tab strip on a phone", () => {
  signedInAsOwner();

  test("never needs a sideways drag, in English", async ({ page }) => {
    await assertNoSidewaysScroll(page, await seededTripPath(page));
  });
});

test.describe("a departure's tab strip on a phone, in Spanish", () => {
  // The locale that actually overflowed. Negotiated through `Accept-Language`,
  // which is how `requestLocale` resolves a reader with no cookie set.
  test.use({ locale: "es-ES" });
  signedInAsOwner();

  test("never needs a sideways drag either", async ({ page }) => {
    await assertNoSidewaysScroll(page, await seededTripPath(page));
  });
});

/**
 * A departure to measure, found without reading any staff copy — the Spanish
 * run cannot look for an English region name, and the trip's own title is shop
 * data rather than a translated string.
 */
async function seededTripPath(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/shop/blue-mantis/schedule/board");
  // **Scoped to the day stream, and that scope is the whole point.** The board
  // draws the same departures twice — the chronological stream below `xl`, the
  // week grid from `xl` up — and the grid renders *first* in the DOM. So a bare
  // `.first()` reads "the earliest cell of the week on screen" at one width and
  // "the next departure" at another, which is a different trip. These tests
  // name the trip they land on, so the composition has to be named too.
  const link = page.locator('[data-day-stream] a[href^="/shop/blue-mantis/trips/"]').first();
  // **Attached, not visible.** From `xl` up the stream is `display:none` behind
  // the grid, its links still in the DOM. This only reads an href, so presence
  // is the whole requirement — waiting for a visibility that is never coming is
  // what timed five tests in this file out at 15s on CI, all of them here
  // rather than in what they were testing.
  //
  // A caller that *clicks* needs the copy on screen instead: that is
  // `findTripOnBoard` in `e2e/helpers.ts`, which picks the visible one and can
  // page the board. It takes a title, which is exactly what this helper must
  // not do — the Spanish run cannot read English copy.
  await link.waitFor({ state: "attached" });
  return ((await link.getAttribute("href")) ?? "").replace(/\/(guests|manifest|prep|log)$/, "");
}

/**
 * **The trip packet is a document, and nothing on it may look fillable.**
 *
 * `/shop/<slug>/trips/<id>/print` is the sheet a captain prints and carries.
 * It composes whole pages, so it inherits whatever controls those pages have —
 * and under print media it carried **42 buttons, 9 selects, 48 inputs and 13
 * textareas**, including "Cancel trip", "Remove booking" nine times, and a bare
 * "×" (issue #814). A control printed beside a diver's name looks fillable and
 * records nothing, on the one surface where the difference between a recorded
 * head count and an unrecorded one is the whole product.
 *
 * **This is invisible on screen**, which is why it survived: the page looks
 * like what it is, four live sections stacked. The visual suite does capture
 * this route under print media (`capturePrint(page, "trip-packet")`) and does
 * assert one thing about it — that the trip nav is hidden — so the claim that
 * nothing checked print media is not quite right. What nothing checked is
 * whether anything on the sheet is *interactive*, which a monochrome
 * screenshot cannot answer and a reviewer will not count by eye.
 */
test.describe("the printed trip packet", () => {
  signedInAsOwner();

  test("carries no control a crew member could try to fill in", async ({ page }) => {
    const tripPath = await seededTripPath(page);
    await page.goto(`${tripPath}/print`);
    // The packet's own heading — the destination's render, not a timing guess.
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();

    // What the printer sees, which is not what the screen shows.
    await page.emulateMedia({ media: "print" });
    const controls = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      };
      const found = [...document.querySelectorAll("button, select, textarea, input")].filter(
        visible,
      );
      // Named, not counted: a failure that says "3" sends the next reader
      // hunting, and one that says "Cancel trip" sends them to the section.
      return found.map(
        (element) =>
          `${element.tagName.toLowerCase()}: ${(element.textContent ?? "").trim().slice(0, 30) || (element as HTMLInputElement).name || "(unnamed)"}`,
      );
    });
    expect(controls).toEqual([]);

    // And the facts it exists for are still on it: the departure it is about,
    // the dive plan that only ever lived inside the Overview tab's form, and
    // the roster with the head count.
    await expect(page.getByRole("heading", { name: /Two-Tank Reef/ }).first()).toBeVisible();
    await expect(page.getByText(/Dive 1 ·/)).toBeVisible();
    await expect(page.getByText(/Souls on board/)).toBeVisible();
  });

  /**
   * **Nothing on the sheet is cut off by a page break.**
   *
   * A clipped overflow box is not a scroll region on paper — it is a box whose
   * second half does not exist, and a page break inside one is where a manifest
   * row or half a packing table silently disappears. Every card, divided list
   * and table shell on this page opens one for screen chrome it does not want
   * on paper (rounded corners, a sideways-scrolling table), and a split table
   * loses its column names with them. Both are invisible on screen and
   * invisible in a screenshot of page one, which is why they are asserted.
   */
  test("clips nothing at a page break, and repeats a split table's column names", async ({
    page,
  }) => {
    const tripPath = await seededTripPath(page);
    await page.goto(`${tripPath}/print`);
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();
    await page.emulateMedia({ media: "print" });

    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll(".trip-print-bundle *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.overflowX === "hidden" || style.overflowY === "hidden";
        })
        // Named, not counted — see the assertion above.
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 80)),
    );
    expect(clipped).toEqual([]);

    // `<thead>` is a header group by default, but only a table the browser can
    // fragment reprints it — and the two nested overflow boxes above were what
    // stopped the fragmentation.
    const headerGroups = await page.evaluate(() =>
      [...document.querySelectorAll(".trip-print-bundle thead")].map(
        (head) => getComputedStyle(head).display,
      ),
    );
    expect(headerGroups.length).toBeGreaterThan(0);
    expect(new Set(headerGroups)).toEqual(new Set(["table-header-group"]));
  });

  /**
   * **The tank counts are three tiles on a screen and one line on paper.** The
   * tiles are right for a wall-mounted screen read across the room and wrong
   * for a sheet carried to the boat: three cards of whitespace holding two
   * digits each pushed the packing list that follows them onto its own page.
   */
  test("says the tank counts inline rather than as three tiles", async ({ page }) => {
    const tripPath = await seededTripPath(page);
    await page.goto(`${tripPath}/prep`);
    const tanks = page.getByRole("heading", { name: "Tanks" });
    await tanks.waitFor();
    const section = page.locator("section").filter({ has: tanks });

    // `exact` is what tells the two apart: the tile's label is the word on its
    // own, the printed line is "Total 20 · Air 20 · Nitrox 0".
    const tileLabel = section.getByText("Total", { exact: true });
    const printedLine = section.getByText(/^Total \d+/);

    // On screen: the tiles, and no inline line.
    await expect(printedLine).toBeHidden();
    await expect(tileLabel).toBeVisible();

    await page.emulateMedia({ media: "print" });
    // On paper: the line, and no tiles.
    await expect(printedLine).toBeVisible();
    await expect(tileLabel).toBeHidden();
  });
});
