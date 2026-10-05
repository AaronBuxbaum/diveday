import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  createTrip,
  daysFromNow,
  e2eNow,
  HELD_SEND_TIMEOUT_MS,
  openCounterFor,
  openIfClosed,
  openPaperWaiverForm,
  openTripFromBoard,
  publicTripUrl,
  seededTripId,
} from "./helpers";

test.describe.configure({ timeout: 45_000 });

signedInAsOwner();

/**
 * The counter's own URL, allowing the `#booking-<id>` an arrival-lookup match
 * lands on — the hash scrolls to that diver's row and changes nothing else.
 */
function onCounter(path: string): RegExp {
  return new RegExp(`${path}(#booking-[0-9a-f-]+)?$`);
}

/** A seeded boat still ahead of the frozen clock and inside the counter's window. */
const OPEN_BOAT = "Two-Tank Reef — Molasses & French";

test("counter check-in finds a diver's boat, confirms live readiness, and keeps blocked rows out of the line", async ({
  page,
}) => {
  // Today's arrival lookup finds the boat; its match opens that departure's
  // Check-in tab, the counter for that one boat.
  const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
  await expect(page).toHaveURL(onCounter(counterPath("blue-mantis", tripId)));
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  const card = page
    .locator("article")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true });
  await expect(card).toHaveCount(1);
  // One readiness vocabulary and one tone per state
  // (src/i18n/readiness-labels.ts): the counter used to call this diver "Needs
  // attention" in warning while the manifest called the same person "Blocked"
  // in danger. The danger-tone Badge prepends a decorative aria-hidden glyph
  // (Badge.tsx toneGlyph), so the element's own text is "Blocked".
  await expect(card.getByText("Blocked")).toBeVisible();
  // **The one reason is on the row, full stop.** A disclosure hiding a
  // single reason made the row a staffer must act on the least informative
  // thing in the queue (issue #759). Priya has exactly one, so there is
  // nothing to open. The counter used to keep money, medical answers and age
  // behind a tap here (issue #716); #890 settled it — this is a staff
  // surface like any other, so nothing on a blocked row is withheld any more.
  await expect(card.getByText("Waiver has not been sent.")).toBeVisible();
  await expect(card.getByText(/Why: \d+ reasons?/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toHaveCount(0);

  // A lookup that finds nobody says so, naming what was typed.
  await page.goto("/shop/blue-mantis?q=not-a-real-diver");
  await expect(page.getByText("Nobody arriving matches “not-a-real-diver”.")).toBeVisible();
});

/**
 * **The other half of the disclosure.** A diver with a stack of reasons keeps
 * it collapsed — five of them open on three rows is the scannability it
 * exists for, spent — but the closed state names the worst reason (the
 * readiness engine's own order) rather than counting alone. Nothing is
 * special-cased out of that order any more, money included: #890 removed the
 * check-in counter's old privacy filter, so the summary would name
 * "Payment is outstanding for this trip." here too if it were this diver's
 * worst reason (it isn't — the waiver is).
 */
test("a diver blocked five ways names the worst reason and counts the rest", async ({ page }) => {
  await openCounterFor(page, "blue-mantis", "Tomás Ferreira");

  const card = page.locator("article").filter({ hasText: "Ferreira" }).filter({ visible: true });
  await expect(card).toHaveCount(1);
  const summary = card.getByText("Waiver has not been sent. And 4 more reasons.");
  await expect(summary).toBeVisible();
  await expect(card.getByText("Payment is outstanding for this trip.")).toBeHidden();

  await summary.click();
  await expect(card.getByText("Payment is outstanding for this trip.")).toBeVisible();
});

/**
 * The queue's one-tap grammar: the whole row is the control (the same
 * roll-call pattern the manifest speaks), and a settled row tapped again
 * undoes the check-in — re-tap, never a confirm dialog (design principle 7).
 *
 * The row now **sinks** on the tap: it leaves the working queue for its
 * departure's collapsed settled group (ADR 20260827-clearwater-surface-language,
 * decision 9). Every assertion below is on the final DOM — the settled group's
 * own heading and the undo control inside it — and never on the 150ms
 * fade-out that carries the row there. An e2e that waited on motion is exactly
 * what `pnpm check:e2e-hygiene` refuses.
 */
test("a ready diver checks in with one tap, sinks into the settled group, and a re-tap undoes it", async ({
  page,
}) => {
  await openCounterFor(page, "blue-mantis", "Diego Alvarez");

  const row = page
    .locator("article")
    .filter({ hasText: "Diego Alvarez" })
    .filter({ visible: true });
  await row.getByRole("button", { name: "Check in Diego Alvarez" }).click();

  // The settled group IS the confirmation — no success banner restates it from
  // the top of the page (design principle 9), and no sentence teaching the
  // re-tap either: the control's accessible name already says "Undo". Other
  // divers on the same boat may already be in it, so the count is not pinned.
  const settledHeading = page.getByRole("heading", { name: /^Checked in — \d+$/ });
  await expect(settledHeading).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Check in Diego Alvarez" })).toHaveCount(0);

  // A boat still ahead keeps its receipts folded; open them to reach the row.
  await openIfClosed(page.locator("details").filter({ has: settledHeading }));
  // **The row itself says nothing about its state, and that is the point.**
  // The group header above it already says "Checked in — n"; the drawn mark
  // and its two words on every row under it were that statement repeated per
  // receipt (principle 9). What still names the act is the tap's accessible
  // name, which is also what a screen reader reads.
  const undo = page.getByRole("button", { name: "Undo check-in for Diego Alvarez" });
  await expect(undo).toBeVisible();
  await expect(undo).toContainText("Diego Alvarez");
  await expect(undo).not.toContainText("Checked in");
  // Still no sentence teaching the re-tap, which was true before the mark went
  // and has to stay true now that the row's end is quiet.
  await expect(undo).not.toContainText("undo");

  await undo.click();
  await expect(page.getByRole("button", { name: "Check in Diego Alvarez" })).toBeVisible({
    timeout: 15_000,
  });
});

/**
 * **J2, at the counter's own device.** The tablet on the front-desk stand is
 * the width this surface is designed for, so the viewport is set here rather
 * than inherited — `TABLET_SURFACES` in `visual.spec.ts` governs the captures,
 * not this spec.
 *
 * What it pins is the instrument itself: one departure with the count
 * leading, queue rows at the counter's 56px floor, the walk-in door at the
 * foot, and — on a boat that has already sailed — the settled receipts open.
 */
test("the counter reads as an instrument at the tablet on the desk", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const sailedId = await seededTripId(page, "blue-mantis", "Dawn Two-Tank — Molasses Reef");
  const openId = await seededTripId(page, "blue-mantis", OPEN_BOAT);

  await page.goto(counterPath("blue-mantis", openId));
  await expect(page.getByRole("heading", { name: OPEN_BOAT, level: 1 })).toBeVisible();
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue).toBeVisible();

  // The count leads, before any list.
  await expect(page.getByText(/^\d+ of \d+ here$/)).toBeVisible();

  // A queue row clears the counter's own 56px floor.
  const firstTap = queue.getByRole("button", { name: /^(Check in|Undo check-in for) / }).first();
  await expect(firstTap).toBeVisible();
  expect((await firstTap.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);

  // The walk-in door stands at the foot of the queue.
  await expect(queue.getByRole("link", { name: "Add a walk-in" })).toBeVisible();

  // A boat that has already sailed is read rather than worked: its receipts
  // are the point, so the settled group arrives open.
  await page.goto(counterPath("blue-mantis", sailedId));
  const settledHeading = page.getByRole("heading", { name: /^Checked in — \d+$/ });
  await expect(settledHeading).toBeVisible();
  await expect(page.locator("details").filter({ has: settledHeading })).toHaveJSProperty(
    "open",
    true,
  );
  // Nobody can be seated on a boat that has left, so its door is not drawn.
  await expect(page.getByRole("link", { name: "Add a walk-in" })).toHaveCount(0);

  // **And it is not all-clear, because three of the eight aboard are blocked.**
  // Every diver on this boat is `checked_in`, which used to be the whole
  // condition for the coral line — so the instrument painted the earned moment
  // over divers readiness will not clear, on the one surface whose job is to
  // catch that ashore. The line now needs "nobody blocked" as well, the count
  // says how many cannot board, and those rows stay out in the working list
  // with their reasons instead of sinking into the receipts (ADR
  // 20260827-clearwater-surface-language, decision 9).
  await expect(page.getByRole("status").filter({ hasText: "Everyone’s checked in" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/can’t board yet/)).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Blocked" }).filter({ visible: true }).first(),
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
  // The bare counter URL, asserted rather than a `?notice=` this page erases:
  // `toHaveURL` retries, so this waits for `FlashParams` to strip the code and
  // proves it actually did — a looser pattern would pass either way.
  await expect(page).toHaveURL(counter);
  await expect(
    page.getByText("Added to this boat’s list, but their waiver wasn’t emailed."),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Walk-in Test Diver" }).filter({ visible: true }),
  ).toHaveCount(1);
});

/**
 * **The counter's own guess, cleared at the counter** (H-13, issues #1556 and
 * #1696).
 *
 * The walk-in name prompt is where a held seat comes from: a staffer types a
 * name, the prompt offers the diver already on file, and a tap attaches the
 * booking to that person's record on something short of proof. Until this
 * landed, the only control that cleared the flag was on the trip roster — so
 * the counter tapped check in, met `checkInBooking`'s `not_ready` refusal,
 * followed its link to the trip, expanded a confirm there and walked back, with
 * a diver at the desk and a queue behind them.
 *
 * The whole loop in one pass, because the loop is the feature: the guess, the
 * held row, the attestation on that row, and the boarding it releases.
 */
test("a walk-in seated off the name prompt is confirmed and checked in without leaving the queue", async ({
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

  // The seating says the seat is held, in the counter's own words, rather than
  // letting "Added" imply the diver can board.
  await expect(
    page.getByText("the seat is held until you confirm it’s the same person", { exact: false }),
  ).toBeVisible();
  // Back on this boat's counter, with the notice's code already stripped — so
  // the render the row is acted on below is the settled one, not one a
  // navigation is about to replace (and with it the confirm's client state).
  await expect(page).toHaveURL(counter);

  const card = page.locator("article").filter({ hasText: "Zoe Bennett" }).filter({ visible: true });
  await expect(card.getByText("Blocked")).toBeVisible();
  // Held: the two answers stand on the row, "Same person" and "Different person".
  await expect(card.getByRole("button", { name: "Same person as Zoe Bennett" })).toBeVisible();
  // The gate the whole change is about: a held row offers no check-in.
  await expect(card.getByRole("button", { name: "Check in Zoe Bennett" })).toHaveCount(0);

  // **Two taps, not one.** The attestation releases another person's
  // certifications and release onto this seat and has no undo, so the trigger
  // arms and a second, deliberate tap posts it.
  await card.getByRole("button", { name: "Same person as Zoe Bennett" }).click();
  await expect(card.getByText("Is the person at the counter Zoe Bennett?")).toBeVisible();
  await card.getByRole("button", { name: "Yes, this is them" }).click();

  // It lands in place — still this boat's counter — and the row it landed on
  // now offers the boarding the flag was refusing.
  await expect(card.getByRole("button", { name: "Check in Zoe Bennett" })).toBeVisible();
  await expect(page).toHaveURL(counter);
  await expect(card.getByRole("button", { name: /^Same person as / })).toHaveCount(0);

  // And `checkInBooking` re-reads readiness for itself, so this tap is the
  // proof the flag is gone from the row rather than only from the render.
  await card.getByRole("button", { name: "Check in Zoe Bennett" }).click();
  await expect(page.getByRole("button", { name: "Check in Zoe Bennett" })).toHaveCount(0);
  // A boat still ahead keeps its receipts folded; open them to reach her row.
  const settledHeading = page.getByRole("heading", { name: /^Checked in — \d+$/ });
  await openIfClosed(page.locator("details").filter({ has: settledHeading }));
  await expect(page.getByRole("button", { name: "Undo check-in for Zoe Bennett" })).toBeVisible();
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
  const tripId = page.url().match(/\/trips\/([^/?]+)/)?.[1];
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
    new RegExp(`/shop/blue-mantis/trips/${tripId}/check-in/walk-in\\?notice=walkin-full$`),
  );
  // Regression: this refusal rendered with no role at all, so screen readers
  // heard nothing. Danger notices announce as alerts (noticeRole); filtered
  // because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "That boat is full" })).toBeVisible();
  await expect(
    page.getByText("That boat is full. Try the wait list on the Divers tab instead."),
  ).toBeVisible();
});

/**
 * The counter's paper-waiver escape hatch. A diver standing at the desk with a
 * signed release in hand used to leave the staffer no way forward from here —
 * the only "mark signed on paper" control lived on the trip's roster, so
 * clearing the blocker meant leaving the queue and hunting for the departure.
 */
test("the counter records a paper waiver and the diver becomes checkable in place", async ({
  page,
}) => {
  const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
  const counter = counterPath("blue-mantis", tripId);

  const card = page
    .locator("article")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true });
  await expect(card.getByText("Blocked")).toBeVisible();

  await openPaperWaiverForm(card);
  // The medical attestation is the control, not a buried confirm. The
  // browser's own `required` already blocks an unchecked submit; strip it to
  // prove the *server* refuses too, rather than trusting client convenience
  // with a signed release that nobody attested the medical side of.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[name="medicalAttested"]')) {
      el.removeAttribute("required");
    }
  });
  await card.getByRole("button", { name: "Record paper signature" }).click();
  // Under the button that was pressed, on the row it is about: the refusal
  // answers in the form's own action state now rather than redirecting with a
  // `?notice=` (issue #1674), so the words are the contract and there is no
  // query param left to read.
  await expect(
    card.getByText("Confirm you reviewed the medical questionnaire", { exact: false }),
  ).toBeVisible();

  // **Neither outcome navigates.** The refusal used to, landing on the bare
  // queue — so the row was rebuilt, and the form the staffer had filled in
  // closed behind a "Mark signed on paper" button with everything they typed
  // gone (the step that timed out on CI). Now the form is still open, still on
  // this row: the staffer's next act is the single box the refusal named.
  await expect(page).toHaveURL(onCounter(counter));
  await card
    .getByLabel("I have this diver’s signed release on file", { exact: false })
    .filter({ visible: true })
    .check();
  await card.getByRole("button", { name: "Record paper signature" }).click();

  // Success lands **in place** too: no banner, no navigation, so the next act
  // is one tap on the same row. Same immutable record a self-service signature
  // produces, so the blocker is genuinely gone rather than merely hidden.
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toBeVisible();
  await expect(page).toHaveURL(onCounter(counter));
  await expect(page.getByText("Paper waiver recorded")).toHaveCount(0);
});

/**
 * **The counter faces a queue.** A departure's Check-in tab is the counter —
 * the screen on the front desk that divers line up at — and it
 * printed every diver's personal email under their name: a boat's worth of
 * addresses on a screen angled at a lobby, so whoever is second in
 * the queue can read the address of whoever is first (issue #716).
 *
 * The email is a *disambiguator*: it earns its place only where two visible
 * divers share a name, which is what the code that added it always said it was
 * for.
 */
test("the counter shows a diver's email only when another diver shares their name", async ({
  page,
}) => {
  await openCounterFor(page, "blue-mantis", "Priya Sharma");
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  // No two seeded divers share a name, so the whole queue renders without a
  // single address. Asserted on the queue region rather than the page.
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue.getByText(/@example\.com/)).toHaveCount(0);

  // Looking up by email still finds the diver's boat — that path is a staffer
  // typing on Today, never a display, and it must not have been narrowed with
  // the display.
  await page.goto(
    `/shop/blue-mantis?q=${encodeURIComponent("success+priya.sharma@simulator.amazonses.com")}`,
  );
  await expect(page.getByRole("link", { name: /check-in for Priya Sharma$/ })).toHaveCount(1);
});

/**
 * **A dropped signal must not take the queue with it.**
 *
 * Offline, one tap on "Check in" used to be replaced by the whole segment's
 * error boundary: the queue and the scroll position, all gone — in front of a
 * diver standing at the desk (issue #819). DiveDay's headline capability is
 * that the head count works with no signal, and it does, on the *boat*; the
 * counter is one nav tab away and a marina's wifi is exactly as bad at the desk.
 *
 * This is the one case in the suite that needs a deliberate `setOffline`, which
 * is why it never turned up by accident: on any working connection the failed
 * mutation and the failed render are the same event.
 */
test("a dropped signal at the counter fails on the row, not on the page", async ({
  page,
  context,
}) => {
  // A diver who is *checkable*, so the row this taps exists — and waited for
  // by the counter's own render, never a timer: going offline mid-navigation
  // leaves no rows to tap at all.
  await openCounterFor(page, "blue-mantis", "Lena Fischer");
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue).toBeVisible();
  const row = queue.getByRole("button", { name: "Check in Lena Fischer" });
  await expect(row).toBeVisible();

  await context.setOffline(true);
  await row.click();

  // The row says the tap did not send — and never that the check-in did or did
  // not happen, which the client cannot know.
  await expect(page.getByRole("alert").filter({ hasText: "That didn’t send" })).toBeVisible();

  // And the page is still the page: the queue and the row.
  await expect(queue).toBeVisible();
  await expect(row).toBeVisible();
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
 * **The offer rides the shipped invite.** The counter's panel points at the
 * departure's own wait list, where `WaitlistInvite` sends through the held-send
 * path with its eight-second undo and its composer fallback — no second sender
 * anywhere in this tree. Sending one is also what moves the counter's own
 * offer on, since `noShowSalvage` counts only the entries nobody has chased.
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

  // Odile Marchand is seeded carded and deliberately booked on nothing
  // (`src/db/seed-cert-gates.ts`), so she clears this trip's Open Water
  // baseline and is the only diver on this boat.
  await page.goto(walkIn);
  const findDiver = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await findDiver.fill("Odile Marchand");
  await findDiver.press("Enter");
  await page.getByRole("button", { name: "Add Odile Marchand to this boat" }).click();
  await page.waitForURL(/\/check-in(\?|$)/);

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
  // — and the door is on the row a staffer can act on, not on a blocked one.
  // The counter's own paper-waiver control clears it in place, which is the
  // ordinary counter path for a diver standing there with a signed form.
  await page.goto(counter);
  const odile = page
    .locator("article")
    .filter({ hasText: "Odile Marchand" })
    .filter({ visible: true });
  await expect(odile).toHaveCount(1);
  await openPaperWaiverForm(odile);
  await odile
    .getByLabel("I have this diver’s signed release on file", { exact: false })
    .filter({ visible: true })
    .check();
  await odile.getByRole("button", { name: "Record paper signature" }).click();
  await expect(odile.getByRole("button", { name: "Check in Odile Marchand" })).toBeVisible();

  // **The door, and one tap inside it.** Closed it is three words under the
  // check-in tap; open it says what the tap does before it does it.
  await odile.getByText("Not here?").click();
  await expect(
    odile.getByText("Records that they did not arrive and frees the seat.", { exact: false }),
  ).toBeVisible();
  await odile.getByRole("button", { name: "Mark Odile Marchand as not here" }).click();

  // The row stays on the page in its own group — never folded, because it is
  // the one row left with work attached to it — wearing the plain word and an
  // Undo for the diver who walks up as the lines come off.
  await expect(page.getByRole("heading", { name: "Not here — 1" })).toBeVisible();
  const released = page
    .locator("article")
    .filter({ hasText: "Odile Marchand" })
    .filter({ visible: true });
  await expect(released.getByText("Not here", { exact: true })).toBeVisible();
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
  // is recorded either way, and *that* is the fact the counter reads next. The
  // row says it in both halves: the button becomes a re-send, and the line
  // under it dates the invite.
  await expect(page.getByRole("status").filter({ hasText: /Sending/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-send invite" })).toBeVisible({
    timeout: HELD_SEND_TIMEOUT_MS,
  });
  await expect(page.getByText("Invited just now")).toBeVisible();

  // **The counter stops counting a diver somebody has already chased.** Nora
  // is still on the list; she is no longer an offer, because sending two staff
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
  await page.waitForURL(/\/check-in(\?|$)/);

  await page.goto(counter);
  await expect(
    page.locator("article").filter({ hasText: "Diego Alvarez" }).filter({ visible: true }),
  ).toHaveCount(1);
  // Odile's row is still here, and still hers: a released seat sold on is not
  // a deleted booking, and the crew reading this boat gets both facts.
  await expect(page.getByRole("heading", { name: "Not here — 1" })).toBeVisible();
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

  // Matched to the departure she holds a seat on — the match is a row on that
  // boat's counter, which is where its link goes.
  const match = page.getByRole("link", { name: /check-in for Priya Sharma$/ }).first();
  await expect(match).toBeVisible();
  await match.click();
  await page.waitForURL(/\/trips\/[0-9a-f-]{36}\/check-in(#.*)?$/);
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue.getByText("Priya Sharma").first()).toBeVisible();
});
