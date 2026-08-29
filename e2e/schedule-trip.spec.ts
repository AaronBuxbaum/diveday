import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  daysFromNow,
  e2eNow,
  openTripAbout,
  signInAsOwner,
  tripPathByTitle,
} from "./helpers";

signedInAsOwner();

/**
 * Creating a trip happens on the board now (ADR 20260806-one-trip-create-form),
 * and the board is a far heavier render than the single-purpose form page it
 * replaced — KPI tiles, a keyset page of departures, per-trip crew and day
 * counts — so every create in this file pays one board render on the way in and
 * another on the way out. Measured against the default 15s budget that is not a
 * hang, it is aggregate per-navigation cost across a sequence, the same
 * reasoning e2e/role-permissions.spec.ts and e2e/visual.spec.ts already carry.
 */
const BOARD_FLOW_TIMEOUT_MS = 30_000;

test("staff schedules a trip and it appears on shop and public schedules", async ({ page }) => {
  test.setTimeout(BOARD_FLOW_TIMEOUT_MS);
  // Unique title so assertions target this spec's own trip, never a seeded
  // one. (Isolation across tests comes from the per-test demo reset in
  // fixtures.ts, not from this suffix.)
  const title = `Turtle Reef Special ${e2eNow().getTime()}`;

  // One form, on the board, opened where the board already is: the quick
  // fields, then "More options" for the dive plan (ADR
  // 20260806-one-trip-create-form). No second page to leave for.
  await page.goto("/shop/blue-mantis/schedule/board");
  await page.getByRole("link", { name: "Add a departure", exact: true }).click();
  await page.getByRole("button", { name: "More options" }).click();

  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:30");
  await page.getByLabel("Seats").fill("8");
  await page.getByLabel("Number of dives").selectOption("3");
  await page.getByLabel("Name").nth(0).fill("Morning reef");
  await page
    .getByLabel("Diver-facing details")
    .nth(1)
    .fill("Second site details will be confirmed at the dock.");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("status")).toBeVisible(); // created banner (param is one-shot)
  await expect(page.getByRole("status")).toContainText(title);

  // View as a diver: a staff session puts a preview banner on
  // /s/<slug>/trips/[id]; the public dive plan ("The day") is what a signed-out
  // visitor gets.
  await page.context().clearCookies();
  await page.goto("/s/blue-mantis");
  // Scoped to the trip list itself, the page's one stable anchor for
  // departures — day rules and other lists on the page never carry a
  // trip's title.
  const card = page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: title })
    .filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(card.getByText("8 spots left").filter({ visible: true })).toBeVisible();

  await card.click();
  // What the staffer typed, read back in the diver's own words: the three tanks
  // in plan order under "The day", with dive one wearing the name it was given.
  // The heading counted the dives ("Your 3-dive plan") and each tank carried its
  // own prose until 2026-08-28; the count is now the last row's own number and
  // the prose is the thread's, since a dive's briefing is preparation and
  // preparation is for a diver who has a seat (ADR 20260827-the-divers-thread,
  // decision 2).
  await expect(page.getByRole("heading", { name: "The day" })).toBeVisible();
  await expect(page.getByText("Dive 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Morning reef", { exact: true })).toBeVisible();

  // Cancel the trip — this leg exercises the staff cancel control itself;
  // test isolation is already handled by the per-test demo reset in
  // fixtures.ts.
  const tripUrl = page.url();
  await signInAsOwner(page);
  await page.goto(tripUrl);
  // Signed in, the booking page stays put and offers the management view
  // rather than redirecting there — the redirect is what used to make the trip
  // overview's own "View booking page" button impossible to use.
  await page.getByRole("link", { name: "Manage this trip" }).click();
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);
  await openTripAbout(page);
  await page.getByRole("button", { name: /Cancel (trip|this departure)/ }).click();
  await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
});

test("the old /trips/new URL still works — 308 to the board's own form", async ({ page }) => {
  // Removing a surface never removes the destination: a bookmark, a training
  // doc, a chat link. The `?course=` a catalogue link carried survives too.
  const direct = await page.request.get("/shop/blue-mantis/trips/new", {
    maxRedirects: 0,
  });
  expect(direct.status()).toBe(308);
  expect(direct.headers().location).toContain("/shop/blue-mantis/schedule/board?add=full");

  await page.goto("/shop/blue-mantis/trips/new");
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/schedule\/board\?add=full$/);
  // Landed on the whole form, not merely the board.
  await expect(page.getByRole("button", { name: "Fewer options" })).toBeVisible();
  await expect(page.getByLabel("How often")).toBeVisible();
});

test("end-before-start is rejected with a friendly message", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board?add=full");
  await page.getByLabel("What is it").fill("Backwards Trip");
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("12:00");
  await page.getByLabel("Returns").fill("09:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "end after it starts" })).toBeVisible();
  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("heading", { name: "Backwards Trip" })).not.toBeVisible();
});

test("a multi-day departure is one trip with a meeting day per day", async ({ page }) => {
  test.setTimeout(BOARD_FLOW_TIMEOUT_MS);
  // `trip_schedule_days` could always describe a departure that meets on
  // consecutive days — the trip page prints the list, the board badges the
  // count, `moveTrip` slides them together — but nothing could create one, so
  // an Open Water weekend went on the board as unrelated trips sharing a
  // title: separate rosters, separate waivers, separate crew.
  const title = `Open Water Weekend ${e2eNow().getTime()}`;
  await page.goto("/shop/blue-mantis/schedule/board?add=full");
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(6));
  await page.getByLabel("Departs").fill("08:30");
  await page.getByLabel("Returns").fill("12:30");
  await page.getByLabel("Seats").fill("6");
  await page.getByLabel("How many days").fill("3");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // One row on the board, badged with its span — not three look-alikes.
  await page.goto("/shop/blue-mantis/schedule/board");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("3 days");

  // The trip's own page lists every meeting day, and the details editor can
  // shrink the departure back down without deleting and rebuilding it.
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByText("3 meeting days · same instructors each day")).toBeVisible();
  // The details form waits behind its Edit disclosure (summary-first Overview).
  await openTripAbout(page);
  await page.getByText("Edit details", { exact: true }).click();
  await page.getByLabel("Days").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("2 meeting days · same instructors each day")).toBeVisible();

  // **And the diver is told.** Every assertion above this line passed while the
  // booking page still printed day one's date and time range and stopped, so a
  // student bought a seat on a course weekend with no way to learn there was a
  // second day (`meetingDays` reaching `TripHeader`). The staff side knowing is
  // not the feature.
  // Straight to the public path rather than through "View booking page", which
  // is `target="_blank"` — clicking it opens a tab this `page` never becomes.
  const tripId = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await expect(page.getByText(/^2 days · /)).toBeVisible();
  await expect(page.getByText(/^Day 1 · /)).toBeVisible();
  await expect(page.getByText(/^Day 2 · /)).toBeVisible();
});

/**
 * **Moving a departure to another hull** — the edit this exists for (issue
 * #681).
 *
 * The boat, the dive mode and the public/private flag were settable only when a
 * departure was created. So the commonest real edit — the boat that was going
 * to run this is in for service, put it on the other one — had no route at all,
 * and delete-and-recreate is not available once anyone has booked, because
 * `deleteTrip` refuses a departure carrying bookings.
 */
test("staff moves a departure to a different boat after it is on the board", async ({ page }) => {
  test.setTimeout(BOARD_FLOW_TIMEOUT_MS);
  const tripPath = await tripPathByTitle(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(tripPath);

  // The Details form lives behind `EditDisclosure` — the card states the
  // settled facts and opens to edit them, as a `<details>`/`<summary>` rather
  // than a button (a focusable descendant of a summary fails axe's
  // nested-interactive rule). Every field below is inside it.
  await openTripAbout(page);
  await page.getByText("Edit details", { exact: true }).click();
  // Located by its form name, the same shape `visual.spec.ts` uses for the
  // onboarding inputs. Not by label: `Field` renders its `(optional)` hint
  // inside the caption, so an accessible-name match here is fragile in a way
  // that says nothing about the behaviour under test. There is exactly one
  // boat select on this page, so it needs no scoping.
  const boat = page.locator('select[name="boatId"]');
  await expect(boat).toBeVisible();

  // The seeded shop runs two hulls; pick whichever is not on the departure now,
  // so the assertion is about the change rather than about the seed.
  const before = await boat.inputValue();
  // Two hulls seeded, so the picker has options — asserted rather than assumed,
  // because an empty list would leave `other` empty and fail eight lines later
  // as "no other boat" rather than as "the select never rendered".
  await expect(boat.locator("option")).not.toHaveCount(0);
  const options = await boat.locator("option").all();
  const other = [];
  for (const option of options) {
    const value = await option.getAttribute("value");
    if (value && value !== before) other.push(value);
  }
  if (other.length === 0) throw new Error("expected the seeded shop to run more than one boat");

  await boat.selectOption(other[0]);
  await page.getByRole("button", { name: "Save changes" }).click();
  // Wait for the save to *land* before navigating away. `saveDetails` ends in
  // `revalidateAndRedirect(back, noticeUrl(back, "saved"))`, so this banner is
  // the destination's own proof the write happened — the same wait
  // `booking.spec.ts` uses on this form. Without it the `goto` below races the
  // in-flight server action and can preempt it, and because the seeded
  // departure sails with no hull at all, the read-back then returns the empty
  // value the select started at: the failure reads as "the boat was never
  // stored" rather than as the navigation that cancelled the store.
  await expect(page.getByRole("status")).toContainText("Changes saved");

  // Read back off a fresh render: the point is that it *stored*, not that the
  // select kept what was typed into it.
  await page.goto(tripPath);
  await openTripAbout(page);
  await page.getByText("Edit details", { exact: true }).click();
  await expect(page.locator('select[name="boatId"]')).toHaveValue(other[0]);
});

/**
 * A departure's own meeting point, when it isn't the shop's own front door
 * (issue #704 slice 2) — a marina three miles out, a shore dive's beach car
 * park. Staff sets it on the trip's own details form; the diver reads it on
 * the exact line ("Arrive and check in") that used to say only a time.
 *
 * That line is the dock-day rhythm, and the rhythm moved to the diver's thread
 * with `PackingSection` (ADR 20260827-the-divers-thread, decision 2 — what to
 * bring and when to be there is preparation, and preparation is for a diver who
 * has a seat). So this takes a seat before it reads the meeting point, exactly
 * as the three journeys in `dock-day-rhythm.spec.ts` do for the same line.
 */
test("a departure's own meeting point reaches the diver on their thread", async ({ page }) => {
  test.setTimeout(BOARD_FLOW_TIMEOUT_MS);
  const tripPath = await tripPathByTitle(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(tripPath);

  await openTripAbout(page);
  await page.getByText("Edit details", { exact: true }).click();
  // By form name, not label: `Field` renders its "(optional)" hint inside
  // the caption, so an accessible-name match here is fragile — same reason
  // the boat-swap test above locates its `<select>` this way.
  await page.locator('input[name="meetingPointLabel"]').fill("North Jetty Marina");
  await page.locator('input[name="meetingPointAddress"]').fill("12 Dock Rd");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");

  const tripId = tripPath.split("/").pop();
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await bookASeatAndOpenThread(page, "Jetty Reader");
  await expect(page.getByText("North Jetty Marina")).toBeVisible();
  await expect(page.getByText("12 Dock Rd")).toBeVisible();
});
