import type { Page } from "@playwright/test";
import { expect, makeActivitySafe, signedInAs, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard, seededTripId } from "./helpers";

/**
 * The staffing week (`/shop/[shopSlug]/staffing`): people down the side, the
 * shop's seven days across the top, and the departures that still need crew in
 * the day cell where the work is (ADR 20260827-the-shops-shelves, decision 3).
 *
 * Three things worth knowing before reading the assertions:
 *
 * - The seed gives **every** staff member one 12-hour shift *today*
 *   (`src/db/seed.ts`, `SEEDED_SHIFT` below), and the frozen clock puts today at
 *   Tuesday 21 July 2026, 09:30 in the shop's own zone — so the default week
 *   is Mon 20 – Sun 26 July and it is never empty.
 * - Paging is `?week=<ISO Monday>`, the schedule board's own grammar
 *   (`src/lib/week-board.ts`). The window form this replaced is gone, and with
 *   it the `?from=`/`?to=` params — an old link is ignored, not refused.
 * - The grid and the day list are **both** in the DOM, one hidden by CSS at any
 *   width. The fleet drives at 1279px, above the grid's `lg` floor, so role
 *   queries reach the grid and skip the day list; where a text query is
 *   unavoidable it takes the first (visible) match.
 * - **The seeded week is a clean week.** The DOM-M3 charter (the divemaster
 *   driving, the captain on the lines) sails a week out, past this one
 *   (`seed-trips.ts`); today's reef boat is crewed the ordinary way. Assertions
 *   here still name their own departure rather than counting the week's chips.
 */

const STAFFING = "/shop/blue-mantis/staffing";

/**
 * The seeded shift every member of the cast works today (`seedStaffShifts`,
 * `src/db/seed.ts`), read by its hours: it carries no note, since a seed label
 * on every chip read as a fixture rather than a shop (UX audit 2026-10-07,
 * item 34). An hour before today's reef boat (2:30 PM at the frozen 9:30 AM
 * clock) and twelve hours long.
 */
const SEEDED_SHIFT = "1:30 PM – 1:30 AM";

/**
 * The Add-a-shift door's form, scoped by the disclosure's own id — the
 * credentials form below it repeats "Staff member" and carries date fields of
 * its own, and `getByLabel` is a case-insensitive substring match.
 */
const addShiftForm = (page: Page) => page.locator("#add-shift");

/** The week grid, named by its own region. */
const weekOf = (page: Page) => page.getByRole("region", { name: "Who’s working" });

/**
 * The one test here that writes a shift takes a shop of its own (`privateShop`,
 * ADR 20260815-per-test-private-shops). `staff_shifts` is one of the tables the
 * per-test reset deliberately leaves standing for the permanent staff — it
 * clears a shift only when it purges the person who owns it — so a shift added
 * to blue-mantis survives into every later spec in the same worker whenever
 * this test fails before reaching its own Remove step.
 *
 * A minted shop carries the same seeded shift for every member
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
  // seeded one.
  const note = `Boat 2 ${e2eNow().getTime()}`;

  await page.goto(`/shop/${privateShop.slug}/staffing`);
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  const week = weekOf(page);
  // The seeded shift is on today, which is inside the week the page opens on.
  await expect(week.getByText(SEEDED_SHIFT).first()).toBeVisible();

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
  await expect(week.getByText(SEEDED_SHIFT)).toHaveCount(0);

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
  await expect(week.getByText(SEEDED_SHIFT).first()).toBeVisible();
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
  test("an empty departure says nothing; the same boat with a diver aboard says nobody is in the water", async ({
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
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
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
    await expect(week.getByText("No divemaster").first()).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(weekOf(page).getByText(SEEDED_SHIFT).first()).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(weekOf(page).getByText(SEEDED_SHIFT).first()).toBeVisible();

    // No door, and no act inside a chip — a control that refuses is worse than
    // a control that is not there.
    await expect(page.getByText("Add a shift")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByText("Add a credential")).toHaveCount(0);
  });

  /**
   * **The crew's own half of the week** (issue #1235, ADR
   * 20260902-crew-requests-and-blackouts). The captain above gets no shift
   * controls and never will — these two are the writes they *do* get, and the
   * point of the slice is that they are the only ones on the page not behind
   * `canPersonManageStaffAccounts`.
   */
  test("a captain tells the shop they're away, and asks for a departure", async ({ page }) => {
    // The demo shop, not a private one: `crew_availability_blocks` and
    // `crew_assignment_requests` are **reset-owned** (`resetDemoSchedule`), so
    // this write is cleared before the next test's fixture rather than leaking
    // into it — and `privateShop` cannot be used from a file that already
    // carries a staff session anyway (its own note in `e2e/fixtures.ts`).
    await page.goto(STAFFING);
    await page.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();

    await page.getByText("Add days away").click();
    const away = page.locator("#add-away");
    await away.getByLabel("From").fill(daysFromNow(2));
    await away.getByLabel("To").fill(daysFromNow(3));
    await away.getByLabel("Note").fill("Family trip");
    await away.getByRole("button", { name: "Save", exact: true }).click();

    // The week draws it, quietly, in their own row — and the door lists it
    // back with the one act that removes it.
    await expect(page.getByText("Family trip").first()).toBeVisible();
    await expect(page.getByText("Saved. The shop can see those days")).toBeVisible();
  });
});

test.describe("a crew member asks to work a short-handed departure", () => {
  // **The instructor, not the captain**: the instructor crews the course days
  // and nothing else, so the ask on a charter nobody crews is one the write
  // would accept — the affordance is only offered where it would.
  signedInAs("instructor");

  test("the ask lands on the departure, and the owner is the one who answers", async ({
    page,
    browser,
    workerBaseURL,
    staffStorageState,
  }) => {
    // An owner builds the departure and seats a diver, then the instructor asks.
    test.setTimeout(60_000);
    // **The seeded week is a clean week** (this file's docblock): every demo
    // boat carries its divemaster and assistant in the water, so the owner
    // makes the short-handed departure the ask exists for. A booked diver and
    // nobody crewing is `uncrewed_departure`; an empty boat needs nobody.
    const title = `Short-handed Charter ${e2eNow().getTime()}`;
    const ownerContext = await browser.newContext({
      baseURL: workerBaseURL,
      storageState: await staffStorageState("owner"),
    });
    try {
      const owner = makeActivitySafe(await ownerContext.newPage());
      await createTrip(owner, {
        title,
        date: daysFromNow(1),
        departsAt: "09:00",
        returnsAt: "13:00",
        capacity: 6,
      });
      await owner.goto("/shop/blue-mantis/schedule/board");
      await openTripFromBoard(owner, title);
      // Inside the arrivals window "Add a diver" is one search field, and a
      // booked seat is its empty result's "Add diver" (UX audit item 24).
      const find = owner.getByRole("searchbox", { name: "Find a returning diver" });
      await find.fill("Needs A Divemaster");
      await find.press("Enter");
      await owner.getByRole("link", { name: "Add diver", exact: true }).first().click();
      await owner.waitForURL(/\/divers\/new/);
      await owner.getByLabel("Full name").fill("Needs A Divemaster");
      await owner.getByLabel("Email").fill(`short-${e2eNow().getTime()}@example.com`);
      await owner.getByRole("button", { name: "Add to trip" }).click();
      await owner.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
    } finally {
      await ownerContext.close();
    }

    await page.goto(STAFFING);
    await page.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
    // By the accessible name, not the visible label: every gap's button reads
    // "Ask for this one", so the departure it is about lives in the `ariaLabel`
    // (`SubmitButton`) — which is also what a screen reader hears.
    const ask = page.getByRole("button", { name: `Ask to work ${title}` }).first();
    await expect(ask).toBeVisible();
    await ask.click();
    await expect(page.getByText("Sent. The shop will see it on the week.")).toBeVisible();
    // Their own name, on the departure they asked for, waiting on somebody.
    await expect(page.getByText(/asked$/).first()).toBeVisible();
    // And no way to answer their own ask — that is the owner's, and the domain
    // layer refuses it besides.
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });
});

test.describe("schedule views", () => {
  signedInAsOwner();

  /**
   * **Schedule is one place with two views** (ADR 20261001-logbook): the week of
   * departures and the same week by crew, one tab apart, and a step to another
   * week survives the switch.
   */
  test("the week and its crew are two views of one Schedule, and the week travels between them", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/schedule/board?week=2026-08-03");
    const views = page.getByRole("navigation", { name: "Schedule views" });
    await expect(views.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("link", { name: "Crew" }).click();
    await page.waitForURL(/\/staffing\?week=2026-08-03$/);
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(views.getByRole("link", { name: "Crew" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("link", { name: "Week" }).click();
    await page.waitForURL(/\/schedule\/board\?week=2026-08-03$/);
  });
});

/**
 * **Approving a divemaster onto an intro session that is over its ratio**
 * (issue #1676; the behaviour is #1339's). An intro cap is
 * instructor-to-student, so a divemaster aboard adds no seats — and three
 * things say so only in that state: the sentence beside Approve, the
 * approval's own notice, and the asker's own line on the departure. The
 * layers below pin each; this walks them in a browser.
 *
 * The state is the trouble-states route's opt-in `introOverRatio` switch,
 * never the demo seed: a permanently short-handed demo would move Today and
 * every capture that reads it. `crew_assignment_requests` is reset-owned, so
 * the ask and its approval are cleared before the next test.
 */
test.describe("approving a divemaster onto an intro session over its ratio", () => {
  signedInAsOwner();

  /**
   * The session's own cell: the smallest visible box holding both its title and
   * `marker`. Ancestors come first in document order, so the last match is the
   * cell itself, never the week around it or another departure's cell.
   */
  function sessionCell(page: Page, title: string, marker: string) {
    return page
      .locator("div, li")
      .filter({ visible: true })
      .filter({ hasText: title })
      .filter({ hasText: marker })
      .last();
  }

  test("the approver is told it adds no seats, and so is the divemaster who asked", async ({
    page,
    request,
    browser,
    workerBaseURL,
    staffStorageState,
  }) => {
    test.setTimeout(60_000);
    const seeded = await request.post("/api/test/seed-trouble-states?introOverRatio=1");
    expect(seeded.ok()).toBe(true);
    const { introOverRatio } = (await seeded.json()) as {
      introOverRatio?: { tripId: string; title: string; asker: string; date: string };
    };
    if (!introOverRatio) throw new Error("seed-trouble-states found no intro session to crowd");
    const { title, asker, date } = introOverRatio;
    // The week the session sits in, whichever week the frozen clock is in.
    const sessionWeek = `${STAFFING}?week=${date}`;
    const asked = `${asker} asked`;
    const ownLineText = "You add no seats to this session. Only another instructor does.";

    const divemasterContext = await browser.newContext({
      baseURL: workerBaseURL,
      storageState: await staffStorageState("divemaster"),
    });
    try {
      const divemaster = makeActivitySafe(await divemasterContext.newPage());

      // The asker, before anybody answers: their ask stands, and the line
      // telling them it closes nothing stays on the departure after it.
      await divemaster.goto(sessionWeek);
      await divemaster.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
      const askerCell = sessionCell(divemaster, title, asked);
      await expect(askerCell.getByText(asked, { exact: true })).toBeVisible();
      await expect(askerCell.getByText(ownLineText)).toBeVisible();

      // The owner: the sentence sits beside Approve, and the approval says the
      // session is still over its ratio rather than the plain success.
      await page.goto(sessionWeek);
      await page.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
      const ownerCell = sessionCell(page, title, asked);
      await expect(ownerCell.getByText(asked, { exact: true })).toBeVisible();
      await expect(
        ownerCell.getByText(
          "Approving this one adds no seats to this session. Only an instructor does.",
        ),
      ).toBeVisible();
      await ownerCell.getByRole("button", { name: "Approve" }).click();
      await expect(
        page.getByText(
          "Approved, and they’re on the crew. The session is still over its ratio: only an instructor adds seats.",
        ),
      ).toBeVisible();

      // The asker again, now on the crew: the session is no less over its
      // ratio, so their line is still there.
      await divemaster.reload();
      await divemaster.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
      await expect(
        sessionCell(divemaster, title, ownLineText).getByText(ownLineText),
      ).toBeVisible();
    } finally {
      await divemasterContext.close();
    }
  });
});
