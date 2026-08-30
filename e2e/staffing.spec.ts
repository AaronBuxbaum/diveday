import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, seededTripId } from "./helpers";

/**
 * The staffing week (`/shop/[shopSlug]/staffing`): people down the side, the
 * shop's seven days across the top, and the departures that still need crew in
 * the day cell where the work is (ADR 20260827-the-shops-shelves, decision 3).
 *
 * Three things worth knowing before reading the assertions:
 *
 * - The seed gives **every** staff member one 12-hour shift *today*
 *   (`src/db/seed.ts`, "Demo schedule"), and the frozen clock puts today at
 *   Tuesday 21 July 2026, 09:30 in the shop's own zone — so the default week
 *   is Mon 20 – Sun 26 July and it is never empty.
 * - Paging is `?week=<ISO Monday>`, the schedule board's own grammar
 *   (`src/lib/week-board.ts`). The window form this replaced is gone, and with
 *   it the `?from=`/`?to=` params — an old link is ignored, not refused.
 * - The grid and the day list are **both** in the DOM, one hidden by CSS at any
 *   width. The fleet drives at 1279px, above the grid's `lg` floor, so role
 *   queries reach the grid and skip the day list; where a text query is
 *   unavoidable it takes the first (visible) match.
 * - **The seeded week is not a clean week.** The demo's headline charter is the
 *   one whose divemaster is driving it and whose captain is on the lines
 *   (`seed-trips.ts`, the DOM-M3 case), so nobody on it is supervising in the
 *   water — Today already says so, and this surface now agrees. Assertions here
 *   name their own departure rather than counting the week's chips.
 */

const STAFFING = "/shop/blue-mantis/staffing";

/**
 * The Add-a-shift door's form, scoped by the disclosure's own id — the
 * credentials form below it repeats "Staff member" and carries date fields of
 * its own, and `getByLabel` is a case-insensitive substring match.
 */
const addShiftForm = (page: Page) => page.locator("#add-shift");

/** The week grid, named by its own region. */
const weekOf = (page: Page) => page.getByRole("region", { name: "Who's working" });

/**
 * The one test here that writes a shift takes a shop of its own (`privateShop`,
 * ADR 20260815-per-test-private-shops). `staff_shifts` is one of the tables the
 * per-test reset deliberately leaves standing for the permanent staff — it
 * clears a shift only when it purges the person who owns it — so a shift added
 * to blue-mantis survives into every later spec in the same worker whenever
 * this test fails before reaching its own Remove step.
 *
 * A minted shop carries the same seeded "Demo schedule" shift for every member
 * of the cast (`seedStaffShifts`, src/db/seed.ts), which is what the
 * before-and-after assertions below read.
 */
test("an owner puts a shift in a day, steps a week off it, and takes it back off", async ({
  page,
  privateShop,
}) => {
  // The mint and the live sign-in the fixture pays for, then a create, two
  // week steps and a delete — full server round trips, all inside this test's
  // own budget.
  test.setTimeout(60_000);
  // Thursday of the week the frozen clock sits in, where nobody is scheduled:
  // the seeded shift is on today (Tuesday), and `createStaffShift` refuses an
  // overlap.
  const shiftDay = daysFromNow(2);
  // Unique, so the assertions target this test's own shift rather than the
  // seeded "Demo schedule" one.
  const note = `Boat 2 ${e2eNow().getTime()}`;

  await page.goto(`/shop/${privateShop.slug}/staffing`);
  await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();
  const week = weekOf(page);
  // The seeded shift is on today, which is inside the week the page opens on.
  await expect(week.getByText("Demo schedule").first()).toBeVisible();

  // The two add-forms became one door (decision 3), and it opens in place.
  await page.locator("#add-shift > summary").click();
  await addShiftForm(page).getByLabel("Staff member").selectOption({ label: "Keiko Tanaka" });
  await addShiftForm(page).getByLabel("Date").fill(shiftDay);
  await addShiftForm(page).getByLabel("Starts").fill("06:30");
  await addShiftForm(page).getByLabel("Ends").fill("14:45");
  await addShiftForm(page).getByLabel("Note").fill(note);
  await addShiftForm(page).getByRole("button", { name: "Add shift" }).click();

  // The door answers for itself — the outcome lands in its own action row
  // rather than in a banner a screen above it.
  await expect(page.getByText("Shift saved.")).toBeVisible();
  // Read back through the shop's own timezone, not the wall time it was typed
  // in: this fails if the shift is written or bucketed in the host's zone.
  await expect(week.getByText("6:30 AM – 2:45 PM").first()).toBeVisible();
  await expect(week.getByText(note).first()).toBeVisible();

  // Step a week forward. Nothing on this page filters in the browser — this is
  // a link to another reading of the week, and a fresh server render.
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(/week=/);
  await expect(week.getByText(note)).toHaveCount(0);
  await expect(week.getByText("Demo schedule")).toHaveCount(0);

  // Back to the week that has it, and take it off. The chip is the disclosure;
  // Remove is what it opens onto.
  await page.getByRole("link", { name: "This week" }).click();
  const chip = week.locator("details").filter({ hasText: note }).first();
  await chip.locator("> summary").click();
  await chip.getByRole("button", { name: "Remove" }).click();

  // The delete comes back to the week it was performed in — this one, since
  // the step above walked home — and the banner is the observable, because
  // `FlashParams` has already stripped `?notice=` from the URL by the time an
  // assertion could read it.
  await expect(page.getByText("Shift removed.")).toBeVisible();
  await expect(week.getByText(note)).toHaveCount(0);
  await expect(week.getByText("Demo schedule").first()).toBeVisible();
});

/**
 * A save on any week other than this one used to land the staffer back on
 * this week: "Shift saved." above a grid the shift is not in, with the add
 * form's date reset under it — and the natural recovery, adding it again, is
 * refused as an overlap. The act now carries the week it was performed in.
 */
test("a shift added on another week comes back to that week", async ({ page, privateShop }) => {
  test.setTimeout(60_000);
  const note = `Next week ${e2eNow().getTime()}`;

  await page.goto(`/shop/${privateShop.slug}/staffing`);
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(/week=/);
  const nextWeekUrl = page.url();

  await page.locator("#add-shift > summary").click();
  const form = addShiftForm(page);
  await form.getByLabel("Staff member").selectOption({ label: "Keiko Tanaka" });
  // The date the form offers is inside the week on screen, so a save needs
  // no correction — filling only the note proves it.
  await form.getByLabel("Note").fill(note);
  await form.getByRole("button", { name: "Add shift" }).click();

  await expect(page.getByText("Shift saved.")).toBeVisible();
  // Same week, and the shift is on it. `FlashParams` keeps `?week=` — it is
  // a reading of the page, not one-shot chrome.
  await expect(page).toHaveURL(new RegExp(`week=${new URL(nextWeekUrl).searchParams.get("week")}`));
  await expect(weekOf(page).getByText(note).first()).toBeVisible();
});

test.describe("staffing", () => {
  signedInAsOwner();

  /**
   * The whole rule in one departure: a boat nobody has to crew says nothing,
   * and the same boat with a diver aboard says it in the day it sails, with
   * the act inside the chip.
   *
   * Both halves matter. "Has this departure got a `trip_assignments` row" is
   * the question this surface used to ask, and it answered backwards at both
   * ends — a warning on an empty boat nobody needs to crew, and silence on a
   * full one with only a captain aboard. The measurement is now
   * `divemasterRatioGap`, the same one Today and the trip page read.
   */
  test("an empty departure says nothing; the same boat with a diver aboard says No crew", async ({
    page,
  }) => {
    // A create, a seating, and two reads of the week — full server round
    // trips, and the board is paged to find the departure's id.
    test.setTimeout(60_000);
    const tripDay = daysFromNow(2);
    const title = `Unstaffed charter ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      date: tripDay,
      departsAt: "08:00",
      returnsAt: "12:00",
    });

    await page.goto(STAFFING);
    const week = weekOf(page);
    await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();
    // Nobody booked is nobody to supervise, so there is nothing to warn about
    // yet — the expected state must not arrive as an alert.
    await expect(week.getByText(title)).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Assign crew to ${title}` })).toHaveCount(0);

    // One diver aboard, and now the boat needs somebody in the water with them.
    const tripId = await seededTripId(page, "blue-mantis", title);
    await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
    await page.getByRole("link", { name: "Add diver", exact: true }).click();
    await page.waitForURL(/\/divers\/new/);
    await page.getByLabel("Full name").fill("Waiting On Crew");
    await page.getByRole("button", { name: "Add to trip" }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}`));

    await page.goto(STAFFING);
    // The gap is named, worded and actionable in the day it sails — not a
    // count in a sentence at the top of the page with nowhere to go.
    await expect(week.getByText(title).first()).toBeVisible();
    await expect(week.getByText("No crew").first()).toBeVisible();
    const assign = page.getByRole("link", { name: `Assign crew to ${title}` });
    await expect(assign).toBeVisible();

    // And it goes to that trip's crew section, which is where a boat is
    // actually crewed.
    await assign.click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  });

  test("an old ?from=/?to= link lands on this week rather than nowhere", async ({ page }) => {
    // The window form is gone; the two params it wrote are ignored, not
    // refused, so a bookmark a shop kept still opens the page.
    await page.goto(`${STAFFING}?from=${daysFromNow(30)}&to=${daysFromNow(37)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();
    await expect(weekOf(page).getByText("Demo schedule").first()).toBeVisible();
    // Already on this week, so the way home is absent rather than disabled.
    await expect(page.getByRole("link", { name: "This week" })).toHaveCount(0);
  });
});

test.describe("staffing, as the daily crew", () => {
  signedInAs("captain");

  test("a captain reads the week but gets no shift controls", async ({ page }) => {
    // Shift changes are owner/manager work (`canPersonManageStaffAccounts`,
    // and `requireStaffingManager` refuses the actions server-side); the crew
    // still needs to see who is on today. Same shape as the schedule board's
    // "a captain sees the board but none of its controls".
    await page.goto(STAFFING);
    await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();
    await expect(weekOf(page).getByText("Demo schedule").first()).toBeVisible();

    // No door, and no act inside a chip — a control that refuses is worse than
    // a control that is not there.
    await expect(page.getByText("Add a shift")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByText("Add a credential")).toHaveCount(0);
  });
});
