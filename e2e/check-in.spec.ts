import type { Locator, Page } from "@playwright/test";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
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
  seatFromRoster,
  seededTripId,
  walkInFormPath,
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
/** A finished departure's record band for the seats the roll call counted aboard. */
const SAILED_BAND = /^Sailed · \d+$/;
/** Its band for the seats the roll call turned away at the dock. */
const DID_NOT_SAIL_BAND = /^Didn’t sail · \d+$/;

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
 * than inherited — `TABLET_SURFACES` in `visual-harness.ts` governs the captures,
 * not this spec.
 *
 * What it pins is the instrument itself: the count leading the roster, taps at
 * the dock test's 44px floor, "Add a diver" as one search field, and that a
 * boat already home is no instrument at all but its record.
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

  // "Add a diver" is one search field at the counter; someone new is offered by
  // its empty result (UX audit item 24), so no door stands beside it.
  await expect(page.getByRole("searchbox", { name: "Find a returning diver" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add diver", exact: true })).toHaveCount(0);

  // A boat that is home is read rather than worked: its Divers tab is the
  // record, every seat filed by the crew's roll call (UX review 2026-10-10,
  // item 10). The seeded dawn boat carried only divers readiness cleared
  // (#2415; UX review 2026-10-13, item 40), so every seat stands under
  // "Sailed", and nothing of the live counter is drawn: no count, no taps,
  // nothing still to clear. "Didn't sail" is the uncounted-seat capture's.
  await page.goto(counterPath("blue-mantis", sailedId));
  await expect(page.getByRole("heading", { name: SAILED_BAND })).toBeVisible();
  await expect(page.getByRole("heading", { name: DID_NOT_SAIL_BAND })).toHaveCount(0);
  await expect(page.getByText(/^\d+ of \d+ here$/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: CHECKED_IN_BAND })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Still to clear/ })).toHaveCount(0);
  await expect(
    page.locator("#roster").getByRole("button", { name: /^(Check in|Undo check-in for) / }),
  ).toHaveCount(0);
  // Nobody can be seated on a boat that has left, so its door is not drawn.
  await expect(page.getByRole("link", { name: "Add as a walk-in" })).toHaveCount(0);
});

/**
 * **The all-clear never paints over a diver who cannot board** (#2410). A
 * diver checked in at the counter whose release is then taken back is
 * `checked_in` and blocked at once: the counter keeps them under "Still to
 * clear", says somebody can't board yet, and draws no "Everyone's checked in".
 * The rule is unit-tested in `CounterInstrument.test.tsx`; this is the browser.
 */
test("a checked-in diver who is blocked again stays still to clear", async ({ page, request }) => {
  const seeded = await request.post("/api/test/seed-trouble-states?checkedInBlocked=1");
  expect(seeded.ok()).toBe(true);
  const { checkedInBlocked } = (await seeded.json()) as {
    checkedInBlocked?: { tripId: string; personName: string };
  };
  if (!checkedInBlocked) throw new Error("seed-trouble-states made no checked-in blocked diver");
  const { tripId, personName } = checkedInBlocked;

  await page.goto(counterPath("blue-mantis", tripId));
  await expect(page.getByText(/^\d+ of \d+ here$/)).toBeVisible();
  const stillToClear = page.getByRole("heading", { name: /^Still to clear · \d+$/ });
  await expect(stillToClear).toBeVisible();
  await expect(
    stillToClear
      .locator("xpath=following::ul[1]")
      .getByRole("link", { name: personName, exact: true }),
  ).toBeVisible();
  await expect(deskRow(page, personName).getByText("Blocked", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ blocked$/).first()).toBeVisible();
  await expect(page.getByText("Everyone’s checked in")).toHaveCount(0);
});

test("a counter walk-in books straight onto a boat with no email required", async ({ page }) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  const counter = counterPath("blue-mantis", tripId);
  await page.goto(counter);
  // A search for someone who isn't on file falls through to the walk-in, in
  // the Divers tab's own search (UX audit item 24).
  const find = page.getByRole("searchbox", { name: "Find a returning diver" });
  await find.fill("Zzyzx No Such Diver");
  await find.press("Enter");
  await expect(page.getByText(/No returning diver matches/)).toBeVisible();

  await page.getByRole("link", { name: "Add as a walk-in" }).click();
  await page.waitForURL(/\/divers\/new\?.*walkIn=true/);
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
 * **A walk-in family in one pass** (fifth loop, item 9): the same form takes
 * the rest of the party, each with an "Under 18" tick, and seats them all
 * together on the boat.
 */
test("a counter walk-in family is seated together from one form", async ({ page }) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  const counter = counterPath("blue-mantis", tripId);
  await page.goto(counter);
  const find = page.getByRole("searchbox", { name: "Find a returning diver" });
  await find.fill("Zzyzx No Such Diver");
  await find.press("Enter");
  await page.getByRole("link", { name: "Add as a walk-in" }).click();
  await page.waitForURL(/\/divers\/new\?.*walkIn=true/);

  await page.getByLabel("Full name").first().fill("Quillon Brightwater");
  await page.getByRole("button", { name: "Add another person" }).click();
  const second = page.getByRole("group", { name: "Person 2" });
  await second.getByLabel("Full name").fill("Mia Brightwater");
  await second.getByLabel(/Under 18/).check();
  await page.getByRole("button", { name: "Add another person" }).click();
  await page
    .getByRole("group", { name: "Person 3" })
    .getByLabel("Full name")
    .fill("Odo Brightwater");
  await page.getByRole("button", { name: "Add to boat" }).click();

  await expect(page).toHaveURL(counter);
  await expect(page.getByText(/^Everyone is on this boat’s list, together/)).toBeVisible();
  for (const name of ["Quillon Brightwater", "Mia Brightwater", "Odo Brightwater"]) {
    await expect(deskRow(page, name)).toHaveCount(1);
  }
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
  await page.goto(walkInFormPath("blue-mantis", tripId));

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
  // The evidence the confirm is weighed against (H-79, issue #1789): the
  // matched diver's last dive day here, not counting this departure. The seed
  // checks Zoe Bennett in on this morning's dawn boat, 05:30 shop time on the
  // frozen clock's day, so the line names that day.
  await expect(row.getByText(/^Last dive day here: Tue, Jul\s21$/)).toBeVisible();
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

test("the departure door explains an invalid submission on the boat it came from", async ({
  page,
}) => {
  const tripId = await seededTripId(page, "blue-mantis", OPEN_BOAT);
  await page.goto(`${counterPath("blue-mantis", tripId)}?notice=diver-seat-invalid`);
  await expect(page.getByRole("alert").filter({ hasText: "Enter a name" })).toContainText(
    "Enter a name to add a diver.",
  );
});

// The counter's paper pass prints one diver's name for a stranger's pocket
// (shop-on-paper.spec.ts prints a real one). A booking id the shop does not
// hold, or one that is not an id at all, prints nothing: the not-found
// backstop, and not one line of a pass. Read by what renders, not by status:
// the segment's `loading.tsx` has the 200 on the wire before `notFound()`.
test("a pass for a booking the shop does not hold prints nothing", async ({ page }) => {
  for (const id of ["00000000-0000-4000-8000-0000000000ff", "not-a-booking"]) {
    await page.goto(`/shop/blue-mantis/print/pass/${id}`);
    await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
    await expect(page.locator(".paper-sheet")).toHaveCount(0);
    await expect(page.getByText("Show this at the counter, or say your name.")).toHaveCount(0);
  }
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

  // Inside the arrivals window "Add a diver" is one search field, and a booked
  // seat is its empty result's "Add diver" (UX audit item 24).
  const find = page.getByRole("searchbox", { name: "Find a returning diver" });
  await find.fill("Fills The Boat");
  await find.press("Enter");
  await page.getByRole("link", { name: "Add diver", exact: true }).first().click();
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
  await page.goto(walkInFormPath("blue-mantis", tripId));
  await page.getByLabel("Full name").fill("Turned Away Tara");
  await page.getByRole("button", { name: "Add to boat" }).click();

  // A refusal lands on the boat's Divers tab, where the add-diver form says
  // why and the wait list is one tap away.
  await expect(page).toHaveURL(
    new RegExp(`/shop/blue-mantis/trips/${tripId}(?:\\?notice=diver-full)?$`),
  );
  // Regression: this refusal rendered with no role at all, so screen readers
  // heard nothing. Danger notices announce as alerts (noticeRole); filtered
  // because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "That trip is full" })).toBeVisible();
  await expect(
    page.getByText("That trip is full. Add them to the wait list instead."),
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
  await page.goto(`/shop/blue-mantis?q=${encodeURIComponent("priya.sharma@mail.example")}`);
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
 * departure's own wait list, where `OfferSeat` sends through the held-send
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
  // time the desk writes anybody off.** "Not here" opens at the departure
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

  // Odile Marchand is seeded carded and deliberately booked on nothing
  // (`src/db/seed-cert-gates.ts`), so she clears this trip's Open Water
  // baseline and is the only diver on this boat.
  await seatFromRoster(page, tripId, "Odile Marchand");

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
  await odile.getByText("Not here", { exact: true }).click();
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
  await released.getByRole("link", { name: "See who wants in" }).click();
  await page.waitForURL(new RegExp(`/shop/blue-mantis/trips/${tripId}#who-wants-in$`));
  await expect(page.getByRole("heading", { name: /Who wants in/ })).toBeVisible();

  // Tick Nora and offer: the panel's one act, never a button per row.
  await page.getByLabel("Offer Nora Quinn a seat").check();
  await page.getByRole("button", { name: "Offer a seat to 1" }).click();
  // The send holds eight seconds with Undo where the button stood, then runs.
  // The fleet configures no email provider, so the server reports what it
  // could not do and the control falls back to its composer — but the outreach
  // is recorded either way, and *that* is the fact the desk reads next. The
  // row says it: it reads "offered" with the time beside the name.
  await expect(page.getByRole("status").filter({ hasText: /Sending/ })).toBeVisible();
  await expect(page.getByText("offered just now")).toBeVisible({
    timeout: HELD_SEND_TIMEOUT_MS,
  });

  // **The desk stops counting a diver somebody has already chased.** Nora is
  // still on the list; she is no longer an offer, because sending two staff
  // after the same diver is the whole failure `noShowSalvage`'s filter avoids.
  await page.goto(counter);
  await expect(page.getByText("1 diver is waiting for this seat")).toHaveCount(0);
  await expect(
    page.getByText("Nobody is waiting, and no similar departure has room for them."),
  ).toBeVisible();

  // **And the seat is genuinely sellable.** The add-diver search reads the boat as
  // having room again — `getTripWithBooked` counts on the same `seatHeld`
  // predicate the booking transaction enforces — and the sale itself runs
  // through `createBooking`, not through anything this ticket added.
  await page.goto(counter);
  await expect(page.getByRole("searchbox", { name: "Find a returning diver" })).toBeVisible();
  await seatFromRoster(page, tripId, "Diego Alvarez");

  await expect(deskRow(page, "Diego Alvarez")).toHaveCount(1);
  // Odile's row is still here, and still hers: a released seat sold on is not
  // a deleted booking, and the crew reading this boat gets both facts.
  await expect(page.getByRole("heading", { name: "Not here · 1" })).toBeVisible();
});

/**
 * **"Turned away" at the desk** (safety sheet 2026-10-15, item 6; H-135): a
 * diver the desk saw and would not board is recorded as that, with the reason
 * from their own row, and the seat is free before the boat leaves — where
 * "Not here" is still closed.
 */
test("the desk turns a blocked diver away before the boat leaves, says why, and frees the seat", async ({
  page,
}) => {
  const title = `Turned Away ${e2eNow().getTime()}`;
  // 09:45 against the frozen 09:30: still ahead, so "Not here" is closed.
  await createTrip(page, {
    title,
    date: daysFromNow(0),
    departsAt: "09:45",
    returnsAt: "12:00",
    capacity: 1,
  });
  const tripId = await seededTripId(page, "blue-mantis", title);
  const counter = counterPath("blue-mantis", tripId);

  // Odile Marchand is carded and booked on nothing (`src/db/seed-cert-gates.ts`),
  // so on this boat she is blocked on the release alone.
  await seatFromRoster(page, tripId, "Odile Marchand");

  await page.goto(counter);
  const odile = deskRow(page, "Odile Marchand");
  await expect(odile).toHaveCount(1);
  await expect(odile.getByText("Not here", { exact: true })).toHaveCount(0);

  // The door, its one reason already chosen, and one confirm.
  await odile.getByRole("button", { name: "Turn away", exact: true }).click();
  await expect(odile.getByRole("radio", { name: "Waiver" })).toBeChecked();
  await expect(odile.getByRole("radio", { name: "Medical" })).toHaveCount(0);
  await odile.getByRole("button", { name: "Turn Odile Marchand away" }).click();

  // Its own group and its own words, never "Not here".
  await expect(page.getByRole("heading", { name: "Turned away · 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Not here/ })).toHaveCount(0);
  const released = deskRow(page, "Odile Marchand");
  await expect(released.getByText("Seen at the desk, turned away: waiver")).toBeVisible();
  // The one money door that works is the move on their own row (layer 3
  // review, dde-2 #3): no new booking, no orders link that holds no refund.
  // It is a link to that row's Move panel (#2907), not a sentence pointing at it.
  await expect(released.getByText(/^Nothing was charged or refunded\./)).toBeVisible();
  await expect(
    released.getByRole("link", { name: "Move the booking to another day" }),
  ).toHaveAttribute("href", new RegExp(`/trips/${tripId}#move-booking-`));
  await expect(released.getByRole("link", { name: "Open their orders" })).toHaveCount(0);
  await expect(released.getByRole("button", { name: /refund|charge/i })).toHaveCount(0);
  await expect(
    released.getByRole("button", { name: "Put Odile Marchand back on this boat’s list" }),
  ).toBeVisible();

  // The seat is free at once: a full boat draws no search, this one does.
  await page.goto(counter);
  await expect(page.getByRole("searchbox", { name: "Find a returning diver" })).toBeVisible();
});

/**
 * **The diver's own page after the desk turned them away** (layer 3 review,
 * dde-1 F2 and dde-2 #1). Before the boat leaves, the link that walked them
 * through the checklist and the Pay step says one thing: the shop released
 * the seat, talk to the desk. No reason, no Pay, no checklist.
 */
test("a diver turned away before the boat leaves is told the seat was released, and offered nothing to pay", async ({
  page,
  browser,
  workerBaseURL,
}) => {
  const title = `Released Seat ${e2eNow().getTime()}`;
  const name = `Rhea ${e2eNow().getTime()}`;
  // Tomorrow morning: inside the desk's 36-hour reach, and still bookable.
  await createTrip(page, {
    title,
    date: daysFromNow(1),
    departsAt: "09:00",
    returnsAt: "12:00",
    capacity: 4,
  });
  const tripId = await seededTripId(page, "blue-mantis", title);

  const diverContext = await browser.newContext({ baseURL: workerBaseURL });
  const diver = makeActivitySafe(await diverContext.newPage());
  await diver.goto(`/s/blue-mantis/trips/${tripId}`);
  await bookASeatAndOpenThread(diver, name);
  const readyPath = new URL(diver.url()).pathname;

  await page.goto(counterPath("blue-mantis", tripId));
  const row = deskRow(page, name);
  await row.getByRole("button", { name: "Turn away", exact: true }).click();
  await row.getByRole("radio").first().check();
  await row.getByRole("button", { name: `Turn ${name} away` }).click();
  await expect(page.getByRole("heading", { name: "Turned away · 1" })).toBeVisible();

  await diver.goto(readyPath);
  await expect(
    diver.getByRole("heading", { name: "The shop released your seat on this departure" }),
  ).toBeVisible();
  await expect(diver.getByText("Talk to the desk.")).toBeVisible();
  await expect(diver.getByRole("button", { name: /pay/i })).toHaveCount(0);
  await diverContext.close();
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

/**
 * **Today's search falls through to the shop** (fifth loop, item 12): a name
 * that is on file but not arriving today says so, and opens their record,
 * rather than answering with nothing.
 */
test("Today's arrival search says who is on file but not arriving today", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers/new");
  await page.getByLabel("Full name").fill("Zephyrine Quayside");
  await page.getByRole("button", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/[0-9a-f-]{36}/);

  await page.goto("/shop/blue-mantis");
  // The search names itself on the page, not only to a screen reader.
  await expect(page.getByRole("heading", { name: "Find an arriving diver" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Find an arriving diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill("Zephyrine Quayside");
  await search.press("Enter");

  const elsewhere = page.getByTestId("arrival-elsewhere");
  await expect(elsewhere.getByText("Not arriving today")).toBeVisible();
  await expect(elsewhere.getByText("Zephyrine Quayside has nothing booked.")).toBeVisible();
  await elsewhere.getByRole("link", { name: "Open Zephyrine Quayside’s record" }).click();
  await page.waitForURL(/\/divers\/[0-9a-f-]{36}/);
});
