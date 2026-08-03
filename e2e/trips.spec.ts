import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, findTripOnBoard } from "./helpers";

test("the public schedule lists seeded trips with capacity states, a calendar, and per-dive briefings", async ({
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

  // The month calendar shows scheduled dives alongside the list.
  const calendar = page.getByRole("region", { name: "Dive schedule calendar" });
  await expect(calendar).toBeVisible();
  // The calendar defaults to the current month, and the server clock is frozen
  // (E2E_FROZEN_CLOCK), so the heading's year is whatever year that instant
  // falls in — read it from the same source rather than the real wall clock,
  // which would diverge once real time passes the frozen year.
  const currentYear = e2eNow().getUTCFullYear();
  await expect(
    calendar.getByRole("heading", { name: new RegExp(`\\b${currentYear}\\b`) }),
  ).toBeVisible();
  // Each dive is a link into its trip page (labelled by start time so it
  // doesn't collide with the titled cards in the list below).
  await expect(calendar.getByRole("link", { name: /\bdive\b/ }).first()).toBeVisible();
  await expect(
    calendar.locator('a[href*="/trips/"]').filter({ visible: true }).first(),
  ).toBeVisible();

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
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(21));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    // Read the card's href rather than clicking it: the board streams in, so
    // reading `page.url()` after a click races that render.
    const link = await findTripOnBoard(page, "blue-mantis", title);
    const href = await link.getAttribute("href");
    if (!href) throw new Error(`no trip card found for ${title}`);
    await page.goto(href);

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
