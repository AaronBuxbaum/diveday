import type { Locator, Page } from "@playwright/test";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  createTrip,
  daysFromNow,
  e2eNow,
  HELD_SEND_TIMEOUT_MS,
  openCounterFor,
  openPaperWaiverForm,
  openRosterDetails,
  openTripFromBoard,
  publicTripUrl,
  seededTripId,
} from "./helpers";

test.describe.configure({ timeout: 45_000 });

signedInAsOwner();

/**
 * The counter's own URL — a departure's Divers tab — allowing the
 * `#booking-<id>` an arrival-lookup match lands on: the hash scrolls to that
 * diver's row and changes nothing else.
 */
function onCounter(path: string): RegExp {
  return new RegExp(`${path}(#booking-[0-9a-f-]+)?$`);
}

/**
 * One diver's seat on the Divers tab. Scoped to the roster's booking rows and
 * matched on the name's own link, so a name repeated in a reason line, the
 * packing list or a salvage sentence never makes it two rows.
 */
function deskRow(page: Page, name: string): Locator {
  return page
    .locator('#roster li[id^="booking-"]')
    .filter({ visible: true })
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

/** "Checked in · n" — the group a settled arrival sinks into. */
const CHECKED_IN_BAND = /^Checked in · \d+$/;

/** A seeded boat still ahead of the frozen clock and inside the counter's window. */
const OPEN_BOAT = "Two-Tank Reef — Molasses & French";

test("counter check-in finds a diver's boat, confirms live readiness, and keeps blocked rows out of the line", async ({
  page,
}) => {
  // Today's arrival lookup finds the boat; its match opens that departure's
  // Divers tab, which is the counter for that one boat while arrivals are open.
  const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
  await expect(page).toHaveURL(onCounter(counterPath("blue-mantis", tripId)));
  // The desk is open: the count leads the roster.
  await expect(page.getByText(/^\d+ of \d+ here$/)).toBeVisible();

  const row = deskRow(page, "Priya Sharma");
  await expect(row).toHaveCount(1);
  // One readiness vocabulary and one tone per state
  // (src/i18n/readiness-labels.ts): the word is "Blocked" on every surface.
  await expect(row.getByText("Blocked", { exact: true })).toBeVisible();
  // **The reason is on the row**, and a blocked row offers no check-in:
  // readiness is the gate, and a tap beside the reasons would be an act the
  // server refuses.
  await expect(row.getByText("Waiver not signed. Not sent yet.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Check in Priya Sharma" })).toHaveCount(0);

  // A lookup that finds nobody says so, naming what was typed.
  await page.goto("/shop/blue-mantis?q=not-a-real-diver");
  await expect(page.getByText("Nobody arriving matches “not-a-real-diver”.")).toBeVisible();
});

/**
 * **A stack of reasons, every one said.** The old counter folded a diver's
 * reasons behind "And 4 more reasons"; the roster row the desk now works from
 * lists each blocker on its own line under the name, money included (#890: a
 * staff surface withholds nothing from staff), and still offers no tap.
 */
test("a diver blocked five ways shows every reason and no check-in", async ({ page }) => {
  await openCounterFor(page, "blue-mantis", "Tomás Ferreira");

  const row = deskRow(page, "Tomás Ferreira");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Waiver not signed. Not sent yet.")).toBeVisible();
  await expect(row.getByText("Payment is outstanding for this trip.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Check in Tomás Ferreira" })).toHaveCount(0);
});

/**
 * The desk's one-tap grammar on the roster row: a cleared seat ends in "Check
 * in", and the same control in its other state undoes it — re-tap, never a
 * confirm dialog (design principle 7).
 *
 * The row **sinks** on the tap into its own "Checked in" group. Every
 * assertion below is on the final DOM — the group's band and the undo control
 * on the row — never on motion, which `pnpm check:e2e-hygiene` refuses.
 */
test("a ready diver checks in with one tap, sinks into the checked-in group, and a re-tap undoes it", async ({
  page,
}) => {
  await openCounterFor(page, "blue-mantis", "Diego Alvarez");

  const row = deskRow(page, "Diego Alvarez");
  await row.getByRole("button", { name: "Check in Diego Alvarez" }).click();

  // The group IS the confirmation — no success banner restates it from the top
  // of the page (design principle 9). Other divers on the same boat may already
  // be in it, so the count is not pinned.
  const checkedIn = page.getByRole("heading", { name: CHECKED_IN_BAND });
  await expect(checkedIn).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Check in Diego Alvarez" })).toHaveCount(0);

  // The arrived row ends in the control that undoes it, wearing the state's
  // word, with the paper pass beside it for the diver with no phone.
  const undo = row.getByRole("button", { name: "Undo check-in for Diego Alvarez" });
  await expect(undo).toBeVisible();
  await expect(undo).toHaveText("Checked in");
  await expect(undo).toHaveAttribute("data-arrival-tap", "undo");
  await expect(row.getByRole("link", { name: "Print a pass" })).toBeVisible();

  await undo.click();
  await expect(page.getByRole("button", { name: "Check in Diego Alvarez" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByRole("link", { name: "Print a pass" })).toHaveCount(0);
});

/**
 * **J2, at the counter's own device.** The tablet on the front-desk stand is
 * the width this surface is designed for, so the viewport is set here rather
 * than inherited — `TABLET_SURFACES` in `visual.spec.ts` governs the captures,
 * not this spec.
 *
 * What it pins is the instrument itself: the count leading the roster, taps at
 * the dock test's 44px floor, the walk-in door under "Add a diver", and — on a
 * boat that has already sailed — the receipts and the divers who still cannot
 * board, apart.
 */
test("the counter reads as an instrument at the tablet on the desk", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const sailedId = await seededTripId(page, "blue-mantis", "Dawn Two-Tank — Molasses Reef");
  const openId = await seededTripId(page, "blue-mantis", OPEN_BOAT);

  await page.goto(counterPath("blue-mantis", openId));
  await expect(page.getByRole("heading", { name: OPEN_BOAT, level: 1 })).toBeVisible();

  // The count leads, before any list.
  await expect(page.getByText(/^\d+ of \d+ here$/)).toBeVisible();

  // A tap clears the dock test's 44px floor.
  const firstTap = page
    .locator("#roster")
    .getByRole("button", { name: /^(Check in|Undo check-in for) / })
    .first();
  await expect(firstTap).toBeVisible();
  expect((await firstTap.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The walk-in door stands under "Add a diver".
  await expect(page.getByRole("link", { name: "Add a walk-in" })).toBeVisible();

  // A boat that has already sailed is read rather than worked: its receipts
  // stand in their own group.
  await page.goto(counterPath("blue-mantis", sailedId));
  await expect(page.getByRole("heading", { name: CHECKED_IN_BAND })).toBeVisible();
  // Nobody can be seated on a boat that has left, so its door is not drawn.
  await expect(page.getByRole("link", { name: "Add a walk-in" })).toHaveCount(0);

  // **And it is not all-clear, because some of the divers aboard are blocked.**
  // Every diver on this boat is `checked_in`, which used to be the whole
  // condition for the coral line — so the instrument painted the earned moment
  // over divers readiness will not clear. The line needs "nobody blocked" as
  // well, the count says how many cannot board, and those rows stay in "Still
  // to clear" wearing their reasons instead of sinking into the receipts.
  await expect(page.getByRole("status").filter({ hasText: "Everyone’s checked in" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/can’t board yet/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Still to clear" })).toBeVisible();
  await expect(
    page
      .locator('#roster li[id^="booking-"]')
      .filter({ visible: true })
      .filter({ hasText: "Blocked" })
      .first(),
  ).toBeVisible();
});

test("a counter walk-in books straight onto a boat with no email required", async ({ page }) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  const counter = counterPath("blue-mantis", tripId);
  await page.goto(counter);
  await page.getByRole("link", { name: "Add a walk-in" }).click();
  await expect(page.getByRole("heading", { name: "Walk-in", level: 1 })).toBeVisible();
  // The boat is the departure's own, in the path — which is what lets a
  // refusal land back on this same form with the boat still chosen and name
  // the gate it hit.
  await expect(page).toHaveURL(`${counter}/walk-in`);
  // The chosen boat is echoed back so the crew can confirm before adding anyone.
  await expect(page.getByText(OPEN_BOAT, { exact: false }).first()).toBeVisible();

  // A search for someone who isn't on file falls through to adding a diver.
  const walkInSearch = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await walkInSearch.fill("Zzyzx No Such Diver");
  await walkInSearch.press("Enter");
  await expect(page.getByText(/No matches for/)).toBeVisible();

  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new\?/);
  await page.getByLabel("Full name").fill("Walk-in Test Diver");
  // Email and phone are left blank on purpose — the whole point of this flow.
  await page.getByRole("button", { name: "Add to boat" }).click();

  // No email was collected, so no waiver could be mailed — and the notice says
  // so rather than implying one is on its way. This is the *ordinary* counter
  // outcome, not an edge case: the diver is seated and the link is still owed.
  // The bare Divers-tab URL, asserted rather than a `?notice=` this page
  // erases: `toHaveURL` retries, so this waits for `FlashParams` to strip the
  // code and proves it actually did — a looser pattern would pass either way.
  await expect(page).toHaveURL(counter);
  await expect(
    page.getByText("Added to this boat’s list, but their waiver wasn’t emailed."),
  ).toBeVisible();
  await expect(deskRow(page, "Walk-in Test Diver")).toHaveCount(1);
});

/**
 * **The counter's own guess, cleared at the counter** (H-13, issues #1556 and
 * #1696).
 *
 * The walk-in name prompt is where a held seat comes from: a staffer types a
 * name, the prompt offers the diver already on file, and a tap attaches the
 * booking to that person's record on something short of proof. The held row
 * is the roster's own, so its identity confirm is the roster's — and with the
 * desk open, confirming it releases the check-in tap on the same row.
 *
 * The whole loop in one pass, because the loop is the feature: the guess, the
 * held row, the attestation on that row, and the boarding it releases.
 */
test("a walk-in seated off the name prompt is confirmed and checked in without leaving the roster", async ({
  page,
}) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  const counter = counterPath("blue-mantis", tripId);
  await page.goto(`${counter}/walk-in`);
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new\?/);

  // One letter off a diver already on file. `personNamesMatch` compares token
  // sets exactly, so this is the disagreement that raises the flag — the prompt
  // fires on an exact spelling too, and that one is not a guess.
  await page.getByLabel("Full name").fill("Zoe Bennet");
  await page.getByRole("button", { name: "Add to boat" }).click();

  // "Is this the same Zoe Bennet?" — the prompt, with the record it found.
  await expect(page.getByRole("heading", { name: /Is this the same Zoe Bennet\?/ })).toBeVisible();
  await page.getByRole("button", { name: "Zoe Bennett", exact: true }).click();

  // The seating says the seat is held, rather than letting "Added" imply the
  // diver can board.
  await expect(
    page.getByText("the seat is held until you confirm it’s the same person", { exact: false }),
  ).toBeVisible();
  // Back on this boat's Divers tab, with the notice's code already stripped —
  // so the render the row is acted on below is the settled one, not one a
  // navigation is about to replace (and with it the confirm's client state).
  await expect(page).toHaveURL(counter);

  const row = deskRow(page, "Zoe Bennett");
  await expect(row.getByText("Blocked", { exact: true })).toBeVisible();
  // Held: the two answers stand on the row, "Same person" and "Different person".
  await expect(row.getByRole("button", { name: "Same person as Zoe Bennett" })).toBeVisible();
  // The gate the whole change is about: a held row offers no check-in.
  await expect(row.getByRole("button", { name: "Check in Zoe Bennett" })).toHaveCount(0);

  // **Two taps, not one.** The attestation releases another person's
  // certifications and release onto this seat and has no undo, so the trigger
  // arms and a second, deliberate tap posts it.
  await row.getByRole("button", { name: "Same person as Zoe Bennett" }).click();
  await expect(
    row.getByText("Confirm this booking is Zoe Bennett?", { exact: false }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Yes, this is them" }).click();

  // It lands in place — still this boat's Divers tab — and the row it landed
  // on now offers the boarding the flag was refusing.
  await expect(row.getByRole("button", { name: "Check in Zoe Bennett" })).toBeVisible();
  await expect(page).toHaveURL(counter);
  await expect(row.getByRole("button", { name: /^Same person as / })).toHaveCount(0);

  // And `checkInBooking` re-reads readiness for itself, so this tap is the
  // proof the flag is gone from the row rather than only from the render.
  await row.getByRole("button", { name: "Check in Zoe Bennett" }).click();
  await expect(page.getByRole("button", { name: "Undo check-in for Zoe Bennett" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in Zoe Bennett" })).toHaveCount(0);
});

test("the walk-in form explains an invalid submission", async ({ page }) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  await page.goto(`${counterPath("blue-mantis", tripId)}/walk-in?notice=walkin-invalid`);
  await expect(page.getByRole("alert").filter({ hasText: "Enter a name" })).toContainText(
    "Enter a name before adding a walk-in.",
  );
});

test("a full boat refuses a counter walk-in with the wait-list nudge", async ({ page }) => {
  // A same-day, one-seat trip so it's inside the counter's arrivals window
  // and trivially fillable in one step.
  const title = `Walk-in Full Trip ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(0),
    departsAt: "20:00",
    returnsAt: "22:00",
    capacity: 1,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const tripId = page.url().match(/\/trips\/([^/?#]+)/)?.[1];
  if (!tripId) throw new Error("could not read the trip id from the URL");

  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Fills The Boat");
  await page.getByLabel("Email").fill(`fills-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip, but their waiver wasn’t emailed.",
  );

  // The boat is now full — a counter walk-in onto it is refused, not silently
  // dropped, and points the crew at the wait list instead.
  await page.goto(`${counterPath("blue-mantis", tripId)}/walk-in`);
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new\?/);
  await page.getByLabel("Full name").fill("Turned Away Tara");
  await page.getByRole("button", { name: "Add to boat" }).click();

  // A refusal lands back on the walk-in form with the boat still chosen — the
  // staffer's next move is another diver or another boat, not a trip page.
  await expect(page).toHaveURL(
    new RegExp(`/shop/blue-mantis/trips/${tripId}/walk-in\\?notice=walkin-full$`),
  );
  // Regression: this refusal rendered with no role at all, so screen readers
  // heard nothing. Danger notices announce as alerts (noticeRole); filtered
  // because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "That boat is full" })).toBeVisible();
  await expect(
    page.getByText("That boat is full. Add them to the wait list instead."),
  ).toBeVisible();
});

/**
 * **A paper release at the desk.** A diver standing at the counter with a
 * signed release in hand is cleared by the roster row's own "Mark signed on
 * paper" control — the same one the Divers tab always had — and with the desk
 * open the same row then offers the check-in, without leaving the list.
 */
test("a paper waiver recorded on the roster row makes the diver checkable in place", async ({
  page,
}) => {
  const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
  const counter = counterPath("blue-mantis", tripId);

  const row = deskRow(page, "Priya Sharma");
  await expect(row.getByText("Blocked", { exact: true })).toBeVisible();

  await openRosterDetails(row);
  await openPaperWaiverForm(row);
  // The medical attestation is the control, not a buried confirm. The
  // browser's own `required` already blocks an unchecked submit; strip it to
  // prove the *server* refuses too, rather than trusting client convenience
  // with a signed release that nobody attested the medical side of.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[name="medicalAttested"]')) {
      el.removeAttribute("required");
    }
  });
  await row.getByRole("button", { name: "Record paper signature" }).click();
  // Under the button that was pressed, on the row it is about (issue #1674).
  await expect(
    row.getByText("Confirm you reviewed the medical questionnaire", { exact: false }),
  ).toBeVisible();

  // **Neither outcome navigates.** The form is still open, still on this row:
  // the staffer's next act is the single box the refusal named.
  await expect(page).toHaveURL(onCounter(counter));
  await row
    .getByLabel("I have this diver’s signed release on file", { exact: false })
    .filter({ visible: true })
    .check();
  await row.getByRole("button", { name: "Record paper signature" }).click();

  // The same immutable record a self-service signature produces, so the
  // blocker is genuinely gone rather than merely hidden: the row's next act is
  // one tap.
  await expect(row.getByRole("button", { name: "Check in Priya Sharma" })).toBeVisible();
  await expect(page).toHaveURL(onCounter(counter));
});

/**
 * **The counter faces a queue.** The desk is the screen angled at a lobby, and
 * the old counter printed every diver's personal email under their name, so
 * whoever is second in the queue could read the address of whoever is first
 * (issue #716). The roster the desk now works from keeps contact details in
 * each row's folded panel, never on the name line.
 */
test("the desk shows no diver's email on the roster's face", async ({ page }) => {
  await openCounterFor(page, "blue-mantis", "Priya Sharma");
  await expect(page.getByText(/^\d+ of \d+ here$/)).toBeVisible();

  // Visible text only (the fixture's `getByText`), on the roster's own rows.
  await expect(page.locator("#roster").getByText(/@example\.com/)).toHaveCount(0);

  // Looking up by email still finds the diver's boat — that path is a staffer
  // typing on Today, never a display, and it must not have been narrowed with
  // the display.
  await page.goto(
    `/shop/blue-mantis?q=${encodeURIComponent("success+priya.sharma@simulator.amazonses.com")}`,
  );
  await expect(page.getByRole("link", { name: /check-in for Priya Sharma$/ })).toHaveCount(1);
});

/**
 * **A dropped signal must not take the list with it.**
 *
 * Offline, one tap on "Check in" used to be replaced by the whole segment's
 * error boundary: the list and the scroll position, all gone — in front of a
 * diver standing at the desk (issue #819). DiveDay's headline capability is
 * that the head count works with no signal, and it does, on the *boat*; a
 * marina's wifi is exactly as bad at the desk.
 *
 * This is the one case in the suite that needs a deliberate `setOffline`, which
 * is why it never turned up by accident: on any working connection the failed
 * mutation and the failed render are the same event.
 */
test("a dropped signal at the counter fails on the row, not on the page", async ({
  page,
  context,
}) => {
  // A diver who is *checkable*, so the tap this presses exists — and waited
  // for by the desk's own hydration flag, never a timer: a tap that lands
  // before React owns the form is a plain navigation, and offline that is the
  // browser's error page rather than the row's answer.
  await openCounterFor(page, "blue-mantis", "Lena Fischer");
  await expect(page.locator("[data-check-in-queue]")).toHaveAttribute("data-hydrated", "true");
  const row = deskRow(page, "Lena Fischer");
  const tap = row.getByRole("button", { name: "Check in Lena Fischer" });
  await expect(tap).toBeVisible();

  await context.setOffline(true);
  await tap.click();

  // The row says the tap did not send — and never that the check-in did or did
  // not happen, which the client cannot know.
  await expect(page.getByRole("alert").filter({ hasText: "That didn’t send" })).toBeVisible();

  // And the page is still the page: the roster and the row.
  await expect(row).toBeVisible();
  await expect(tap).toBeVisible();
  await expect(page.getByText("This screen ran into a problem")).toHaveCount(0);

  // The connection is stated before the next tap, not only after it.
  await expect(
    page.getByRole("status").filter({ hasText: "Offline — this board may be out of date" }),
  ).toBeVisible();

  await context.setOffline(false);
});

/**
 * **The respectful no-show salvage, end to end** (issue #1209).
 *
 * One spec for the whole arc, because each step of it is the consequence of
 * the one before: a staffer records that a diver never turned up, the seat
 * that frees is offered to the person already waiting for it, and the boat
 * sells it again. Split into three, each would have to rebuild a full boat
 * with a wait list behind it — the setup *is* most of the cost — and a green
 * "the seat is bookable" that never released one proves nothing.
 *
 * **The seat is never released by arithmetic.** Nothing in this flow
 * decrements a count: the mark changes one booking's status, `seatHeld`
 * (`src/lib/no-show.ts`) stops counting that status toward capacity, and the
 * next diver claims the seat through `createBooking`'s own capacity
 * transaction — the one every door that sells a seat lands on, the counter's
 * walk-in and the storefront's `bookSpot` alike. The walk-in at the end is
 * that claim, which is why it is here rather than an assertion about a number
 * on a page.
 *
 * **The offer rides the shipped invite.** The released row points at the
 * departure's own wait list, where `WaitlistInvite` sends through the held-send
 * path with its eight-second undo and its composer fallback — no second sender
 * anywhere in this tree. Sending one is also what moves the desk's own offer
 * on, since `noShowSalvage` counts only the entries nobody has chased.
 */
test("the counter releases a no-show's seat, offers it to the wait list, and the boat sells it again", async ({
  page,
  request,
}) => {
  // Two sales, a wait-list join in a second browser context, and one
  // eight-second held send (ADR 20260906-before-you-ask, decision 2) chained
  // in one test. The budget is what that chain costs, not a guess at it: the
  // hold alone is a fixed eight seconds of it.
  test.setTimeout(120_000);

  // **A boat that is still ahead while it is being filled, and has left by the
  // time the desk writes anybody off.** "Not here?" opens at the departure
  // rather than at the shop's dock call (`noShowGate`), because a diver late
  // for the arrival time the shop asked for has not missed anything yet — and
  // the two halves of this flow need opposite sides of that line: a wait list
  // takes nobody once the boat has left (`joinTripWaitlist`), and the door
  // exists for nobody until it has. The fleet's clock is frozen at 09:30 in
  // the shop's zone and shared by every spec the worker runs, so the departure
  // moves instead (`/api/test/depart-trip`), which is the lever
  // `seed-evening` already uses for the same reason.
  const title = `Dock Call ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(0),
    departsAt: "09:45",
    returnsAt: "12:00",
    // One seat, so seating one diver fills the boat and the wait list is the
    // only way onto it.
    capacity: 1,
  });
  const tripId = await seededTripId(page, "blue-mantis", title);
  const counter = counterPath("blue-mantis", tripId);
  const walkIn = `${counter}/walk-in`;
  // Seating a walk-in lands back on the Divers tab with its notice.
  const seated = new RegExp(`/trips/${tripId}\\?notice=walkin-added`);

  // Odile Marchand is seeded carded and deliberately booked on nothing
  // (`src/db/seed-cert-gates.ts`), so she clears this trip's Open Water
  // baseline and is the only diver on this boat.
  await page.goto(walkIn);
  const findDiver = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await findDiver.fill("Odile Marchand");
  await findDiver.press("Enter");
  await page.getByRole("button", { name: "Add Odile Marchand to this boat" }).click();
  await page.waitForURL(seated);

  // The diver who wants the seat Odile is about to give up. A signed-out
  // context, because the wait list is a diver-facing form and a staff session
  // on the same page is the manage view.
  const visitorContext = await page.context().browser()?.newContext();
  if (!visitorContext) throw new Error("no browser to open a signed-out context with");
  try {
    const visitor = makeActivitySafe(await visitorContext.newPage());
    await visitor.goto(
      new URL(publicTripUrl(`/shop/blue-mantis/trips/${tripId}`), page.url()).toString(),
    );
    // The boat is full, said by the page a diver reads — which is what makes
    // the wait list the form on offer rather than the booking one.
    await expect(visitor.getByRole("heading", { name: "This boat’s full" })).toBeVisible();
    await expect(visitor.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await visitor.getByLabel("Name").fill("Nora Quinn");
    await visitor.getByLabel("Email").fill(`waitlist-${e2eNow().getTime()}@example.com`);
    await visitor.getByRole("button", { name: "Join the wait list" }).click();
    await expect(
      visitor.getByRole("heading", { name: /You’re on the wait list, Nora/ }),
    ).toBeVisible();
  } finally {
    await visitorContext.close();
  }

  // **The boat leaves.** Ten minutes ago, which is past its departure and
  // inside the hour a late boat is allowed — so the seat is still the shop's to
  // sell, which is what the rest of this flow is about.
  expect(
    (
      await request.post("/api/test/depart-trip", {
        data: { tripId, minutesAgo: 10 },
      })
    ).ok(),
  ).toBe(true);

  // Back at the desk. Odile has no release on file yet, so she arrives blocked
  // — and the door is on a row a staffer can act on, not on a blocked one. The
  // roster row's own paper-waiver control clears it in place, which is the
  // ordinary desk path for a diver standing there with a signed form.
  await page.goto(counter);
  const odile = deskRow(page, "Odile Marchand");
  await expect(odile).toHaveCount(1);
  await openRosterDetails(odile);
  await openPaperWaiverForm(odile);
  await odile
    .getByLabel("I have this diver’s signed release on file", { exact: false })
    .filter({ visible: true })
    .check();
  await odile.getByRole("button", { name: "Record paper signature" }).click();
  await expect(odile.getByRole("button", { name: "Check in Odile Marchand" })).toBeVisible();

  // **The door, and one tap inside it.** Closed it is two words under the
  // check-in tap; open it says what the tap does before it does it.
  await odile.getByText("Not here?").click();
  await expect(
    odile.getByText("Records that they did not arrive and frees the seat.", { exact: false }),
  ).toBeVisible();
  await odile.getByRole("button", { name: "Mark Odile Marchand as not here" }).click();

  // The row stays on the page in its own group — never folded, because it is
  // the one row left with work attached to it — with a way back for the diver
  // who walks up as the lines come off.
  await expect(page.getByRole("heading", { name: "Not here · 1" })).toBeVisible();
  const released = deskRow(page, "Odile Marchand");
  await expect(
    released.getByRole("button", { name: "Put Odile Marchand back on this boat’s list" }),
  ).toBeVisible();
  await expect(released.getByRole("button", { name: "Check in Odile Marchand" })).toHaveCount(0);

  // **The salvage: who the seat can go to, and where the money question
  // lives.** The money is a sentence and a link to the order — there is no
  // charge control and no refund control anywhere in this tree, which is the
  // ticket's own boundary and is asserted rather than trusted.
  await expect(released.getByText("1 diver is waiting for this seat")).toBeVisible();
  await expect(
    released.getByText("Marking someone not here does not charge or refund anything."),
  ).toBeVisible();
  await expect(released.getByRole("button", { name: /refund|charge/i })).toHaveCount(0);

  // The door goes to the shipped control rather than growing a second sender
  // beside it.
  await released.getByRole("link", { name: "Open the wait list" }).click();
  await page.waitForURL(new RegExp(`/shop/blue-mantis/trips/${tripId}#waitlist$`));
  await expect(page.getByRole("heading", { name: /Waiting for a seat/ })).toBeVisible();

  await page.getByRole("button", { name: "Email Nora an invite" }).click();
  // The send holds eight seconds with Undo where the button stood, then runs.
  // The fleet configures no email provider, so the server reports what it
  // could not do and the control falls back to its composer — but the outreach
  // is recorded either way, and *that* is the fact the desk reads next. The
  // row says it in both halves: the button becomes a re-send, and the line
  // under it dates the invite.
  await expect(page.getByRole("status").filter({ hasText: /Sending/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-send invite" })).toBeVisible({
    timeout: HELD_SEND_TIMEOUT_MS,
  });
  await expect(page.getByText("Invited just now")).toBeVisible();

  // **The desk stops counting a diver somebody has already chased.** Nora is
  // still on the list; she is no longer an offer, because sending two staff
  // after the same diver is the whole failure `noShowSalvage`'s filter avoids.
  await page.goto(counter);
  await expect(page.getByText("1 diver is waiting for this seat")).toHaveCount(0);
  await expect(
    page.getByText("Nobody is waiting, and no similar departure has room for them."),
  ).toBeVisible();

  // **And the seat is genuinely sellable.** The walk-in door reads the boat as
  // having room again — `getTripWithBooked` counts on the same `seatHeld`
  // predicate the booking transaction enforces — and the sale itself runs
  // through `createBooking`, not through anything this ticket added.
  await page.goto(walkIn);
  await expect(page.getByText(/0\/1 booked/)).toBeVisible();
  const findSecond = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await findSecond.fill("Diego Alvarez");
  await findSecond.press("Enter");
  await page.getByRole("button", { name: "Add Diego Alvarez to this boat" }).click();
  await page.waitForURL(seated);

  await expect(deskRow(page, "Diego Alvarez")).toHaveCount(1);
  // Odile's row is still here, and still hers: a released seat sold on is not
  // a deleted booking, and the crew reading this boat gets both facts.
  await expect(page.getByRole("heading", { name: "Not here · 1" })).toBeVisible();
});

/**
 * **The counter's half of the same act** (issue #1765, in the browser for
 * #1787).
 *
 * This is the surface the bug was on: the grouped number was printed in one
 * place and not found in another, thirty lines apart, with both halves
 * individually correct. The number is read off the diver's record and pasted
 * here, exactly as a staffer would — a literal would pass while the printer and
 * the matcher drifted apart again.
 */
test("a phone number read off a diver's record finds their seat at the counter", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  const header = page.locator("header").filter({ visible: true }).last();
  const printed = (
    await header.locator('a[href^="tel:"]').filter({ visible: true }).first().innerText()
  ).trim();
  expect(printed).toMatch(/\s/);

  // Typed into Today's arrival lookup, exactly as the desk finds a boat.
  await page.goto("/shop/blue-mantis");
  const search = page.getByRole("searchbox", { name: "Find an arriving diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill(printed);
  await search.press("Enter");

  // Matched to the departure she holds a seat on — the match is her row on
  // that boat's Divers tab, which is where its link goes.
  const match = page.getByRole("link", { name: /check-in for Priya Sharma$/ }).first();
  await expect(match).toBeVisible();
  await match.click();
  await page.waitForURL(/\/trips\/[0-9a-f-]{36}#booking-[0-9a-f-]+$/);
  await expect(deskRow(page, "Priya Sharma")).toBeVisible();
});
