import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  disclosureSettled,
  e2eNow,
  findTripOnBoard,
  HELD_SEND_TIMEOUT_MS,
  openTripActivity,
  openTripFromBoard,
} from "./helpers";

signedInAsOwner();

/**
 * The private-notes `<details>` is uncontrolled — its `open` state is native
 * DOM state React doesn't touch — so whether a server-action redirect leaves
 * it open or resets it closed isn't a stable contract to click blindly
 * against. Check before toggling instead of guessing.
 */
async function openPrivateNotes(page: Page) {
  const details = page
    .locator("details")
    .filter({ hasText: /Private staff notes|Add a private note/ })
    .filter({ visible: true });
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  // `> summary`, matching `openIfClosed` in helpers.ts: roster cards nest
  // disclosures inside disclosures, so a descendant summary is both ambiguous
  // under strict mode and the wrong thing to click. This one stays page-scoped
  // rather than moving to helpers.ts because the spec seats exactly one diver
  // and reads the notes box without first locating a row.
  if (!isOpen) await details.locator("> summary").click();
  // The body animates in, and the frame where `open` flips is not the frame
  // where it is laid out — see `disclosureSettled`. This spec measures a scroll
  // position immediately after opening, so it is the one that noticed.
  await disclosureSettled(details);
  return details;
}

test("staff adds a walk-in diver, then wait-lists one once the trip is full", async ({ page }) => {
  // A held send counts eight seconds down before it leaves (ADR
  // 20260906-before-you-ask, decision 2); this test sends one, so it takes
  // the slow budget rather than racing the hold against the default.
  test.slow();
  // Longest sequential flow in this file: create a trip, add a diver, add a
  // private note, delete it, undo, delete again, then wait-list a second
  // diver — each its own status-toast wait. Same aggregate-cost reasoning as
  // visual.spec.ts's `test.setTimeout`: a traced CI failure showed every
  // individual step resolving successfully, just past the default 15s
  // budget in total — not a hang this override would mask.
  test.setTimeout(30_000);

  // Unique title so assertions target this spec's own trip, never a seeded
  // one. (Isolation across tests comes from the per-test demo reset in
  // fixtures.ts, not from this suffix.)
  const title = `Walk-in Test Trip ${e2eNow().getTime()}`;

  await createTrip(page, {
    title,
    date: daysFromNow(3),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 1,
  });

  // Staff view of a trip card redirects straight into the manage-trip editor.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  // Who is attending — and adding one — lives on the Trip surface now.
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.scrollIntoViewIfNeeded();
  await addDiver.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Walk-in Wanda");
  await page.getByLabel("Email").fill(`wanda-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip, but their waiver wasn’t emailed.",
  );
  await expect(page.getByRole("link", { name: "Walk-in Wanda" })).toBeVisible();
  // The masthead ring owns the capacity read on the Trip surface now, so a
  // full boat is stated in its accessible label without a second badge.
  await expect(page.getByRole("img", { name: "1 of 1 seat, 0 open" })).toBeVisible();

  const privateNotes = await openPrivateNotes(page);
  await privateNotes.scrollIntoViewIfNeeded();
  const notesScroll = await page.evaluate(() => window.scrollY);
  const tripUrl = page.url();
  await page.getByLabel("Add a note only staff can see").fill("Needs a small wetsuit staged.");
  await page.getByRole("button", { name: "Add private note" }).click();
  // No banner: adding a note lands in place now (`addInternalNoteAction`), so
  // the note appearing in the list above the box *is* the confirmation — the
  // page does not navigate, which is the whole point of the change.
  await expect(page).toHaveURL(tripUrl);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - notesScroll))
    .toBeLessThan(100);
  await openPrivateNotes(page);
  await expect(page.getByText("Needs a small wetsuit staged.")).toBeVisible();
  await openTripActivity(page);
  await expect(page.getByText(/added a private note about Walk-in Wanda/)).toBeVisible();

  // Deleting a note is a purely reversible edit (docs/design/principles.md
  // §7): no confirm dialog — the delete lands immediately and a toast offers
  // a one-tap undo instead.
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Private note deleted." })).toBeVisible();
  await expect(page.getByText("Add a private note").first()).toBeVisible();
  await expect(page.getByText("Needs a small wetsuit staged.")).toHaveCount(0);
  await expect(page.getByText(/deleted a private note about Walk-in Wanda/)).toBeVisible();

  // Undo recreates a fresh note carrying the same text, staff-attributed.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status")).toContainText("Private staff note added.");
  await openPrivateNotes(page);
  await expect(page.getByText("Needs a small wetsuit staged.")).toBeVisible();

  // Delete again — the rest of this test doesn't care about the note, only
  // about the trip filling up.
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Add a private note").first()).toBeVisible();

  // Trip is now full — the same section switches to wait-listing.
  await expect(page.getByRole("link", { name: "Add to wait list" })).toBeVisible();
  await page.getByRole("link", { name: "Add to wait list" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Waitlist Wally");
  await page.getByLabel("Email").fill(`wally-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to wait list" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

  await expect(page.getByRole("status")).toContainText("Diver added to the wait list.");
  // The ledger's "Waiting for a seat" group (slice 5d) owns the state word.
  await expect(page.getByRole("heading", { name: /Waiting for a seat/ })).toBeVisible();
  await expect(page.getByText("Waitlist Wally")).toBeVisible();

  // One-tap seat recovery: inviting the next-in-line stamps the entry so a
  // second staffer sees it's already handled. The button opens the mail
  // composer (mailto:) which the test can't follow, so we only assert the
  // recorded state lands.
  const waitRow = page.locator("li").filter({ hasText: "Waitlist Wally" });
  await waitRow.getByRole("button", { name: /Email .* an invite/ }).click();
  // The invite holds eight seconds with Undo first (ADR 20260906-before-you-ask,
  // decision 2), so the recorded state is allowed the hold before it shows.
  await expect(waitRow.getByText(/Invited/).filter({ visible: true })).toBeVisible({
    timeout: HELD_SEND_TIMEOUT_MS,
  });
  await expect(waitRow.getByRole("button", { name: "Re-send invite" })).toBeVisible();
});

test("staff adds a returning diver by picking them, no re-entry", async ({ page }) => {
  // Trip creation, a board navigation, a returning-diver search-and-add, and
  // a second search to confirm the pick is no longer offered — each its own
  // status-toast or navigation wait. Same aggregate-cost reasoning as the
  // walk-in test above: a traced CI failure showed every individual step
  // resolving successfully, just past the default 15s budget in total.
  test.setTimeout(30_000);
  const title = `Returning Diver Trip ${e2eNow().getTime()}`;

  await createTrip(page, {
    title,
    date: daysFromNow(4),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 6,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.scrollIntoViewIfNeeded();

  // Search the shop's existing people and add one by identity — their record,
  // not a re-typed name, lands on the roster.
  // Enter submits the picker's GET form, before and after hydration. The
  // secondary Search button beside it is gone (issue #1230): "Add diver" is
  // the band's one primary, and pressing Enter in a search box is what the
  // button was doing.
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill("Priya");
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");

  const candidate = addDiver.getByRole("button", { name: "Add Priya Sharma to the trip" });
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip, but their waiver wasn’t emailed.",
  );
  const roster = page.locator("#roster");
  await expect(roster.getByText("Priya Sharma").filter({ visible: true })).toBeVisible();

  // Picking the same diver again is no longer offered — the roster can't
  // double-book them.
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill("Priya");
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await expect(page.getByText(/No returning diver matches/)).toBeVisible();
});

/**
 * **A name the shop half-recognises** (issue #1556). Hand-entering a name one
 * letter off a diver already on file stops at the counter's prompt rather than
 * seating anyone; the prompt answers the staffer's real question with the day
 * the shop last had that candidate on a boat; and picking one seats a diver who
 * is *blocked* until a staffer says it is them. A `similarity() > 0.4` trigram
 * match fires on genuinely different people, so the fix is to make a wrong pick
 * harmless rather than to make the matching cleverer.
 */
test("a diver seated off the name prompt is blocked until staff confirm it is them", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const title = `Name Match Trip ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(6),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 6,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.scrollIntoViewIfNeeded();
  await addDiver.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);

  // One letter off "Marisol Vega", who is in the demo shop's trailing quarter
  // of sailed departures (src/db/seed-history.ts) — so she has a dive day and
  // the prompt has something to say beyond repeating the typed name back.
  await page.getByLabel("Full name").fill("Marisol Vegas");
  await page.getByLabel("Email").fill(`marisol-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();

  // Nobody is seated yet: the question is asked by name, the stake is stated,
  // and the evidence is on the candidate.
  await expect(
    page.getByRole("heading", { name: /Is this the same Marisol Vegas\?/ }),
  ).toBeVisible();
  await expect(page.getByText(/Last dive day here: /)).toBeVisible();

  await page.getByRole("button", { name: "Marisol Vega", exact: true }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

  // And the seating itself says the seat is held. It used to answer the plain
  // "Diver added to the trip", so the staffer learned the seat was blocked one
  // tap later — a check-in refusal, with the diver at the counter and the
  // confirm control on this page (`dive-domain-expert`, 2026-09-11).
  await expect(page.getByText(/the seat is held until you confirm/)).toBeVisible();

  // Seated, and blocked on the identity the shop only guessed at — the seat
  // does not inherit her certifications or her waiver on a spelling.
  const roster = page.locator("#roster");
  await expect(roster.getByRole("link", { name: "Marisol Vega" }).first()).toBeVisible();
  await expect(roster.getByText(/Identity unconfirmed/).first()).toBeVisible();

  // One tap at the roster, the same one the shared-inbox path has always cost.
  await page.getByRole("button", { name: "Confirm this is Marisol Vega" }).click();
  await page.getByRole("button", { name: "Yes, this is them" }).click();
  await expect(page.getByRole("status")).toContainText("Identity confirmed.");
  await expect(page.getByText(/Identity unconfirmed/)).toHaveCount(0);
});

/**
 * **An off-origin `?returnTo=`.** The create-diver page takes a return path in
 * the query, shows it as the back link, and hands it to `revalidateAndRedirect`
 * once the diver is written — so before `safeShopReturnPath` a staffer who
 * followed a crafted link was bounced to another origin the moment an
 * authenticated write succeeded, with the app's own success state behind it.
 * Refused by falling back to the roster, never by erroring at the staffer.
 */
test("a returnTo pointing off-origin never survives the create", async ({ page }) => {
  const crafted = "/shop/blue-mantis/divers/new?returnTo=https%3A%2F%2Fevil.invalid%2Fsteal";
  await page.goto(crafted);
  await expect(page.getByRole("heading", { level: 1, name: "Add a diver" })).toBeVisible();

  // A name no seeded diver is a trigram match for, so the create lands rather
  // than stopping at the "is this the same person?" prompt.
  await page.getByLabel("Full name").fill(`Quorrax Zylbender ${e2eNow().getTime()}`);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();

  // The write succeeded and the staffer is still inside their own shop, on the
  // new diver's record — the destination a request with no returnTo gets.
  await page.waitForURL(/\/shop\/blue-mantis\/divers\/[^/?#]+\?edit=1/);

  // ...and the other half of the same param: the back link and Cancel, which a
  // staffer can follow before submitting anything.
  await page.goto(crafted);
  for (const name of ["All divers", "Cancel"]) {
    await expect(page.getByRole("link", { name, exact: true }).first()).toHaveAttribute(
      "href",
      /^\/shop\/blue-mantis\//,
    );
  }
});

/**
 * Creates a departure with room on it and returns its id. Every door below
 * needs one this spec owns, so an assertion can never be satisfied (or broken)
 * by a seeded trip another test also touches.
 */
async function scheduleTrip(page: Page, title: string, inDays: number, capacity = 4) {
  await createTrip(page, {
    title,
    date: daysFromNow(inDays),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity,
  });
  // Creating a departure settles on the board, not on the new trip — so the id
  // is read from the board card's own href (`findTripOnBoard` pages to it),
  // never from `page.url()`.
  const href = await (await findTripOnBoard(page, "blue-mantis", title)).getAttribute("href");
  const tripId = href?.match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error(`could not read the trip id for "${title}"`);
  return tripId;
}

/**
 * Regression: booking a diver from their own record used to skip the waiver
 * entirely — that door called `createBooking` and nothing else — so a diver
 * seated there reached the dock unsigned and no staff surface said why. Every
 * door now goes through `seatDiver` (src/db/seat-diver.ts), so the evidence is
 * the roster's own waiver control reading "Waiver sent".
 */
test("booking a diver from their record issues their waiver, like every other door", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const title = `Diver Record Trip ${e2eNow().getTime()}`;
  const tripId = await scheduleTrip(page, title, 5);

  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: "Priya Sharma" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // "Book a departure" is the record's one primary, and it discloses the
  // picker in place (ADR 20260827-people-not-lists).
  await page.getByText("Book a departure", { exact: true }).click();
  // The picker's option values are trip ids, so this targets *our* departure
  // without depending on how an option label is formatted for the locale.
  await page.getByLabel("Course or dive").selectOption(tripId);
  await page.getByRole("button", { name: "Book activity" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Activity booked, but their waiver wasn’t emailed.",
  );

  await page.goto(`/shop/blue-mantis/trips/${tripId}`);
  await expect(page.getByRole("link", { name: "Priya Sharma" }).first()).toBeVisible();
  await expect(page.getByText("Waiver sent").first()).toBeVisible();
  // ...and the seating reaches the trip's activity trail, which this door also
  // used to skip.
  await openTripActivity(page);
  await expect(page.getByText(/added Priya Sharma to the trip/)).toBeVisible();
});

test("the global Add-booking door seats a diver on a departure chosen from scratch", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const title = `Global Door Trip ${e2eNow().getTime()}`;
  const tripId = await scheduleTrip(page, title, 8);

  // The board's primary action is this door's front entrance.
  await page.goto("/shop/blue-mantis/schedule/board");
  await page.getByRole("link", { name: "Add a booking" }).click();
  await expect(page).toHaveURL(/\/bookings\/new/);
  await expect(page.getByRole("heading", { level: 1, name: "Add a booking" })).toBeVisible();

  // Slice 9g of ADR 20260827-the-shops-shelves: the picker is one ledger
  // grouped by day. The date is the group heading — said once, above the run
  // it describes — rather than repeated on every row, which is what a flat
  // list has to do because it has nothing to hang it from.
  const firstDay = page.getByRole("heading", { level: 3 }).first();
  await expect(firstDay).toBeVisible();
  const dayLabel = ((await firstDay.textContent()) ?? "").trim();
  expect(dayLabel).not.toBe("");
  await expect(
    page.getByRole("list", { name: dayLabel }).getByRole("listitem").first(),
  ).not.toContainText(dayLabel);

  // ...and the command palette is the other one, for a staffer already typing.
  // Opened by the nav button rather than ⌘K, which only works once the page
  // has hydrated (search.spec.ts takes the same care).
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("combobox", { name: /Search divers/ }).fill("booking");
  await page.getByRole("option", { name: "Add a booking" }).click();
  await expect(page).toHaveURL(/\/bookings\/new$/);
  // The picker pages the season, so this spec's own departure can sit past the
  // first page — the door resolves a chosen trip by id either way.
  await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
  await expect(page.getByText(title).first()).toBeVisible();

  // The diver form is a dedicated step shared by all seating doors.
  await page.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  // Name only: this door takes the no-email diver the counter always could.
  await page.getByLabel("Full name").fill("Phoned In Pat");
  await page.getByRole("button", { name: "Add to trip" }).click();

  // Lands on the trip's Trip surface with the roster's usual success affordance.
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}`));
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip, but their waiver wasn’t emailed.",
  );
  await expect(page.getByRole("link", { name: "Phoned In Pat" })).toBeVisible();
});

test("a refusal from the global door stays on the form, boat still chosen", async ({ page }) => {
  test.setTimeout(30_000);
  const title = `Global Door Full ${e2eNow().getTime()}`;
  const tripId = await scheduleTrip(page, title, 9, 1);

  await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
  await page.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("First Aboard Fay");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip, but their waiver wasn’t emailed.",
  );

  // The boat is full now. The refusal comes back to the door that produced it,
  // still pointed at the same departure, so the next diver is one field away.
  await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
  await page.getByRole("link", { name: "Add diver", exact: true }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Too Late Theo");
  await page.getByRole("button", { name: "Add to trip" }).click();

  await expect(page).toHaveURL(new RegExp(`/bookings/new/${tripId}\\?notice=diver-full`));
  // Next's own route announcer is also `role="alert"`, so target the banner.
  await expect(page.getByRole("alert").filter({ hasText: "That trip is full" })).toBeVisible();
  await expect(page.getByText(title).first()).toBeVisible();
});
