import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

test.describe.configure({ timeout: 45_000 });

signedInAsOwner();

test("counter check-in searches by diver, confirms live readiness, and keeps blocked rows out of the line", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  await expect(page.getByRole("heading", { name: "Counter check-in" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill("Priya Sharma");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/check-in\?q=Priya\+Sharma/);

  const card = page
    .locator("article")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true });
  await expect(card).toHaveCount(1);
  // One readiness vocabulary and one tone per state
  // (src/i18n/readiness-labels.ts): the counter used to call this diver "Needs
  // attention" in warning while the manifest called the same person "Blocked"
  // in danger. The danger-tone Badge prepends a decorative aria-hidden glyph
  // (Badge.tsx toneGlyph), so the element's own text is "❌Blocked".
  await expect(card.getByText("❌Blocked")).toBeVisible();
  // **The one reason is on the row, because it is one a lobby may overhear.**
  // This screen calls itself Counter mode — it faces a queue — so a diver's
  // money, medical answers and age stay behind a tap (issue #716). An unsent
  // waiver is not that: it is the fact the staffer and the diver are both
  // standing there to fix, and a disclosure hiding a single one of those made
  // the row a staffer must act on the least informative thing in the queue
  // (issue #759). Priya has exactly one, so there is nothing to open.
  await expect(card.getByText("Waiver has not been sent.")).toBeVisible();
  await expect(card.getByText(/Why: \d+ reasons?/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toHaveCount(0);

  await search.fill("not-a-real-diver");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No one matches that scan" })).toBeVisible();
  // A search that found nobody has one honest way on: drop the search. The
  // counter used to say "no one matches that scan" and stop there — including
  // when nothing had been typed at all (docs/design/principles.md #4).
  await page.getByRole("link", { name: "Show everyone arriving" }).click();
  await expect(page).toHaveURL("/shop/blue-mantis/check-in");
});

/**
 * **The other half of the counter's privacy posture.** A diver with a stack of
 * reasons keeps the disclosure — five of them open on three rows is the
 * scannability it exists for, spent — but the closed state now names the first
 * reason a lobby may overhear rather than counting alone. What must not be on
 * the row, at any count, is the money: "Payment is outstanding for this trip."
 * beside a named person on a screen a queue reads is the sentence issue #716
 * was filed about, and this is the only place a browser holds it.
 */
test("a diver blocked five ways names the first reason and keeps the money behind the tap", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill("Ferreira");
  await search.press("Enter");

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
 */
test("a ready diver checks in with one tap on the row, and a re-tap undoes it", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  await expect(page.getByRole("searchbox", { name: "Scan or search diver" })).toHaveAttribute(
    "data-hydrated",
    "true",
  );

  const row = page
    .locator("article")
    .filter({ hasText: "Diego Alvarez" })
    .filter({ visible: true });
  await row.getByRole("button", { name: "Check in Diego Alvarez" }).click();

  // The settled row IS the confirmation — no success banner restates it from
  // the top of the page (design principle 9), and no sentence under the row
  // teaching the re-tap either: a control the finger just put into "Checked in
  // ☑️" is its own affordance, and its accessible name already says "Undo".
  const settled = page.getByRole("button", { name: "Undo check-in for Diego Alvarez" });
  await expect(settled).toBeVisible({ timeout: 15_000 });
  await expect(settled).toContainText("Checked in ☑️");
  await expect(settled).not.toContainText("undo");

  await settled.click();
  await expect(page.getByRole("button", { name: "Check in Diego Alvarez" })).toBeVisible({
    timeout: 15_000,
  });
});

test("a counter walk-in books straight onto a boat with no email required", async ({ page }) => {
  await page.goto("/shop/blue-mantis/check-in");
  const queueSearch = page.getByRole("searchbox", { name: "Scan or search diver" });
  await queueSearch.fill("Zzyzx No Such Diver");
  await queueSearch.press("Enter");
  await expect(page.getByRole("heading", { name: "No one matches that scan" })).toBeVisible();
  await page.getByRole("link", { name: "Add “Zzyzx No Such Diver” as a walk-in" }).click();
  await expect(page.getByRole("heading", { name: "Walk-in", level: 1 })).toBeVisible();

  const tripSection = page.locator("section").filter({ hasText: "Which boat?" });
  const firstTrip = tripSection.locator("ul li a").filter({ visible: true }).first();
  await expect(firstTrip).toBeVisible();
  const tripText = await firstTrip.innerText();
  const tripTitle = tripText.split(" · ")[0];
  if (!tripTitle) throw new Error("could not read a trip title from the walk-in picker");
  await firstTrip.click();
  // The departure is a path segment, not a `?tripId=` — which is what lets a
  // refusal land back on this same form with the boat still chosen and name
  // the gate it hit.
  await expect(page).toHaveURL(/\/check-in\/walk-in\/[0-9a-f-]{36}(\?.*)?$/);
  // The chosen boat is echoed back so the crew can confirm before adding anyone.
  await expect(page.getByText(tripTitle, { exact: false }).first()).toBeVisible();

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
  // The bare queue URL, asserted rather than a `?notice=` this page erases:
  // `toHaveURL` retries, so this waits for `FlashParams` to strip the code and
  // proves it actually did — a looser pattern would pass either way.
  await expect(page).toHaveURL("/shop/blue-mantis/check-in");
  await expect(
    page.getByText("Added to this boat’s list — but their waiver wasn’t emailed."),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Walk-in Test Diver" }).filter({ visible: true }),
  ).toHaveCount(1);
});

test("the walk-in picker explains an invalid submission before a boat is chosen", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in/walk-in?notice=walkin-invalid");
  await expect(page.getByRole("alert").filter({ hasText: "Choose a boat" })).toContainText(
    "Choose a boat and enter a name before adding a walk-in.",
  );
});

test("a full boat refuses a counter walk-in with the wait-list nudge", async ({ page }) => {
  // A same-day, one-seat trip so it's both offered by the walk-in picker
  // (today's/tomorrow's departures) and trivially fillable in one step.
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

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Fills The Boat");
  await page.getByLabel("Email").fill(`fills-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/guests/);
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );

  // The boat is now full — a counter walk-in onto it is refused, not silently
  // dropped, and points the crew at the wait list instead.
  // The old `?tripId=` shape still lands on the diver step rather than losing
  // the choice — the departure moved into the path when the counter learned to
  // say *why* a diver bounced.
  await page.goto(`/shop/blue-mantis/check-in/walk-in?tripId=${tripId}`);
  await page.waitForURL(`/shop/blue-mantis/check-in/walk-in/${tripId}`);
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new\?/);
  await page.getByLabel("Full name").fill("Turned Away Tara");
  await page.getByRole("button", { name: "Add to boat" }).click();

  // A refusal lands back on the walk-in form with the boat still chosen — the
  // staffer's next move is another diver or another boat, not a trip page.
  await expect(page).toHaveURL(
    new RegExp(`/shop/blue-mantis/check-in/walk-in/${tripId}\\?notice=walkin-full$`),
  );
  // Regression: this refusal rendered with no role at all, so screen readers
  // heard nothing. Danger notices announce as alerts (noticeRole); filtered
  // because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "That boat is full" })).toBeVisible();
  await expect(
    page.getByText("That boat is full — try the wait list from its trip page instead."),
  ).toBeVisible();
});

/**
 * The counter's paper-waiver escape hatch. A diver standing at the desk with a
 * signed release in hand used to leave the staffer no way forward from here —
 * the only "mark signed on paper" control lived on the trip's Guests tab, so
 * clearing the blocker meant leaving the queue and hunting for the departure.
 */
test("the counter records a paper waiver and the diver becomes checkable in place", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill("Priya Sharma");
  await search.press("Enter");

  const card = page
    .locator("article")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true });
  await expect(card.getByText("❌Blocked")).toBeVisible();

  await card.getByText("Mark signed on paper").click();
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
  // The banner, not the query param: `?notice=` is one-shot now (`FlashParams`
  // on the page strips it once the words are on screen), so the words are the
  // contract and the URL is an implementation detail mid-erase.
  await expect(
    page.getByText("Confirm you reviewed the medical questionnaire", { exact: false }),
  ).toBeVisible();

  // A refusal is the one outcome here that still navigates, and it lands on the
  // bare queue — so the search has to be retyped to get back to her.
  await search.fill("Priya Sharma");
  await search.press("Enter");
  await card.getByText("Mark signed on paper").click();
  await card
    .getByLabel("I have this diver's signed release on file", { exact: false })
    .filter({ visible: true })
    .check();
  await card.getByRole("button", { name: "Record paper signature" }).click();

  // Success lands **in place**: no banner, no navigation, and — the point of
  // it — the search that found her is still in the box and still in the URL,
  // so the next act is one tap rather than typing her name a third time. Same
  // immutable record a self-service signature produces, so the blocker is
  // genuinely gone rather than merely hidden.
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toBeVisible();
  await expect(page).toHaveURL(/\/check-in\?q=Priya\+Sharma/);
  await expect(page.getByText("Paper waiver recorded")).toHaveCount(0);
});

/**
 * **The counter faces a queue.** `/shop/[shopSlug]/check-in` calls itself
 * Counter mode — the screen on the front desk that divers line up at — and it
 * printed every diver's personal email under their name. On the seeded shop
 * that is 26 addresses on a screen angled at a lobby, so whoever is second in
 * the queue can read the address of whoever is first (issue #716).
 *
 * The email is a *disambiguator*: it earns its place only where two visible
 * divers share a name, which is what the code that added it always said it was
 * for.
 */
test("the counter shows a diver's email only when another diver shares their name", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  // No two seeded divers share a name, so the whole queue renders without a
  // single address. Asserted on the queue region rather than the page: the
  // search box's own placeholder still names email, which is a staffer typing.
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue.getByText(/@example\.com/)).toHaveCount(0);

  // Searching by email still finds the diver — that path is a staffer typing,
  // never a display, and it must not have been narrowed with the display.
  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  await search.fill("priya.sharma@example.com");
  await search.press("Enter");
  await expect(
    page.locator("article").filter({ hasText: "Priya Sharma" }).filter({ visible: true }),
  ).toHaveCount(1);
});

/**
 * **A dropped signal must not take the queue with it.**
 *
 * Offline, one tap on "Check in" used to be replaced by the whole segment's
 * error boundary: the 26-diver queue, the four departure groups, the scroll
 * position and anything typed into the scan field, all gone — in front of a
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
  await page.goto("/shop/blue-mantis/check-in");
  const queue = page.getByRole("region", { name: "Check-in queue" });
  await expect(queue).toBeVisible();
  const before = await queue.getByRole("button", { name: /^Check in / }).count();
  expect(before).toBeGreaterThan(0);

  // What the staffer typed, which the boundary used to discard along with
  // everything else.
  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await expect(search).toHaveAttribute("data-hydrated", "true");
  // A name that is still *checkable* once the filter lands, so the row this
  // taps exists — and waited for by the filtered queue's own render, never a
  // timer: typing here navigates, and going offline mid-navigation leaves no
  // rows to tap at all. That race made this test fail about one run in three
  // before it was pinned this way.
  await search.fill("Lena");
  const row = queue.getByRole("button", { name: "Check in Lena Fischer" });
  await expect(row).toBeVisible();
  await expect(queue.getByRole("button", { name: /^Check in / })).toHaveCount(1);

  await context.setOffline(true);
  await row.click();

  // The row says the tap did not send — and never that the check-in did or did
  // not happen, which the client cannot know.
  await expect(page.getByRole("alert").filter({ hasText: "That didn’t send" })).toBeVisible();

  // And the page is still the page: the queue, the row, and what was typed.
  // `before` is the unfiltered count, asserted above one so a queue that
  // silently emptied could not have passed the earlier assertion either.
  expect(before).toBeGreaterThan(1);
  await expect(queue).toBeVisible();
  await expect(row).toBeVisible();
  await expect(search).toHaveValue("Lena");
  await expect(page.getByText("This screen ran into a problem")).toHaveCount(0);

  // The connection is stated before the next tap, not only after it.
  await expect(
    page.getByRole("status").filter({ hasText: "Offline — this board may be out of date" }),
  ).toBeVisible();

  await context.setOffline(false);
});
