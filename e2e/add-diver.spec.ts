import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, findTripOnBoard, openTripFromBoard } from "./helpers";

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
}

test("staff adds a walk-in diver, then wait-lists one once the trip is full", async ({ page }) => {
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

  // Who is attending — and adding one — lives on the Guests tab now.
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) })
    .filter({ visible: true });
  await addDiver.scrollIntoViewIfNeeded();
  await addDiver.getByLabel("Name").fill("Walk-in Wanda");
  await addDiver.getByLabel("Email").fill(`wanda-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to trip" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );
  await expect(page.getByRole("link", { name: "Walk-in Wanda" })).toBeVisible();
  // The success-tone Badge prepends a decorative aria-hidden glyph
  // (Badge.tsx toneGlyph), so the element's own text is "✅Full", not
  // "Full" alone — and a bare substring match risks colliding with an
  // unrelated "full" elsewhere on the page.
  await expect(page.getByText("✅Full")).toBeVisible();

  await openPrivateNotes(page);
  await page.getByLabel("Add a note only staff can see").fill("Needs a small wetsuit staged.");
  await page.getByRole("button", { name: "Add private note" }).click();
  // No banner: adding a note lands in place now (`addInternalNoteAction`), so
  // the note appearing in the list above the box *is* the confirmation — the
  // page does not navigate, which is the whole point of the change.
  await openPrivateNotes(page);
  await expect(page.getByText("Needs a small wetsuit staged.")).toBeVisible();
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
  await expect(addDiver.getByRole("button", { name: "Add to wait list" })).toBeVisible();
  await addDiver.getByLabel("Name").fill("Waitlist Wally");
  await addDiver.getByLabel("Email").fill(`wally-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to wait list" }).click();

  await expect(page.getByRole("status")).toContainText("Diver added to the wait list.");
  await expect(page.getByText("Wait list").first()).toBeVisible();
  await expect(page.getByText("Waitlist Wally")).toBeVisible();

  // One-tap seat recovery: inviting the next-in-line stamps the entry so a
  // second staffer sees it's already handled. The button opens the mail
  // composer (mailto:) which the test can't follow, so we only assert the
  // recorded state lands.
  const waitlist = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Wait list" }) });
  await waitlist.getByRole("button", { name: /Email .* an invite/ }).click();
  await expect(waitlist.getByText(/Invited/).filter({ visible: true })).toBeVisible();
  await expect(waitlist.getByRole("button", { name: "Re-send invite" })).toBeVisible();
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
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) })
    .filter({ visible: true });
  await addDiver.scrollIntoViewIfNeeded();

  // Search the shop's existing people and add one by identity — their record,
  // not a re-typed name, lands on the roster.
  await addDiver.getByLabel("Find a returning diver").fill("Priya");
  await addDiver.getByRole("button", { name: "Search" }).click();

  const candidate = addDiver.getByRole("button", { name: "Add Priya Sharma to the trip" });
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );
  const roster = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Divers" }) });
  await expect(roster.getByText("Priya Sharma").filter({ visible: true })).toBeVisible();

  // Picking the same diver again is no longer offered — the roster can't
  // double-book them.
  await addDiver.getByLabel("Find a returning diver").fill("Priya");
  await addDiver.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/No returning diver matches/)).toBeVisible();
});

test("staff sends waivers to a multi-selected roster in one action", async ({ page }) => {
  // Trip creation, a board navigation, two sequential add-diver redirects,
  // two checkbox ticks, and a bulk send: measured 12.5-14.6s under 2-worker
  // contention after the BulkWaiverSelectionProvider remount fix (previously
  // this test also carried an artificial wait for that remount and routinely
  // hit the default budget). Too close to 15s to leave at the default, but
  // no longer needs the flat 30s this file's cost-bound tests use elsewhere.
  test.setTimeout(20_000);
  const title = `Bulk Waiver Trip ${e2eNow().getTime()}`;
  const stamp = e2eNow().getTime();

  await createTrip(page, {
    title,
    date: daysFromNow(6),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 4,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  for (const name of ["Bulk Bea", "Bulk Cal"]) {
    await addDiver.getByLabel("Name").fill(name);
    await addDiver
      .getByLabel("Email")
      .fill(`${name.toLowerCase().replace(/\s+/g, ".")}-${stamp}@example.com`);
    await addDiver.getByRole("button", { name: "Add to trip" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Diver added to the trip — but their waiver wasn’t emailed.",
    );
  }
  // The bulk selection's Client Component (BulkWaiverSelectionProvider) lives
  // in TripLayout, above this page's own re-renders, so a diver-add redirect
  // can no longer remount it out from under a tick mid-selection (see that
  // component's docstring for the failure mode this used to hit). A freshly
  // added diver's checkbox is still a brand-new DOM node, though, so wait for
  // its own hydration before the first interaction.
  const beaCheckbox = page.getByRole("checkbox", { name: "Select Bulk Bea to send a waiver" });
  await expect(beaCheckbox).toHaveAttribute("data-hydrated", "true");

  // The checkbox's real hit area is the label wrapping it, not just the 16px
  // input — .check() below clicks the input directly regardless of markup,
  // so it can't catch a wrapper that fails to forward taps (the exact bug a
  // <span> in place of a <label> would reintroduce). Click near a corner of
  // the label's 44px box, well outside the centered input, to prove the tap
  // target itself — not just the input — toggles the checkbox.
  await beaCheckbox.locator("xpath=..").click({ position: { x: 4, y: 4 } });
  await expect(beaCheckbox).toBeChecked();

  await page.getByRole("checkbox", { name: "Select Bulk Cal to send a waiver" }).check();
  await page.getByRole("button", { name: "Send waivers to selected" }).click();

  // One unified control now handles both the per-diver and bulk sends (Lens
  // 17 — one waiver-send control), so the bulk result reads the same optimistic
  // per-diver breakdown as a single send. e2e has no email provider
  // configured, so both land as private links to share rather than "sent".
  const resultNotice = page.getByRole("status");
  await expect(resultNotice).toContainText("DiveDay can’t send email from this deployment yet");
  await expect(resultNotice).toContainText("Bulk Bea");
  await expect(resultNotice).toContainText("Bulk Cal");
});

test("the bulk waiver send nudges rather than silently no-ops with nothing ticked", async ({
  page,
}) => {
  const title = `Bulk Waiver Empty ${e2eNow().getTime()}`;

  await createTrip(page, {
    title,
    date: daysFromNow(6),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 4,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  await addDiver.getByLabel("Name").fill("Bulk Drew");
  await addDiver.getByLabel("Email").fill(`bulk.drew-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to trip" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );

  await page.getByRole("button", { name: "Send waivers to selected" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Tick at least one diver, then send the waiver to the whole selection.",
  );
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

  // The picker's option values are trip ids, so this targets *our* departure
  // without depending on how an option label is formatted for the locale.
  await page.getByLabel("Course or dive").selectOption(tripId);
  await page.getByRole("button", { name: "Book activity" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Activity booked — but their waiver wasn’t emailed.",
  );

  await page.goto(`/shop/blue-mantis/trips/${tripId}/guests`);
  await expect(page.getByRole("link", { name: "Priya Sharma" }).first()).toBeVisible();
  await expect(page.getByText("Waiver sent").first()).toBeVisible();
  // ...and the seating reaches the trip's activity trail, which this door also
  // used to skip.
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

  // Name only: this door takes the no-email diver the counter always could.
  await page.locator('input[name="fullName"]').filter({ visible: true }).fill("Phoned In Pat");
  await page.getByRole("button", { name: "Add to trip" }).click();

  // Lands on the trip's Guests tab with the roster's usual success affordance.
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/guests`));
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );
  await expect(page.getByRole("link", { name: "Phoned In Pat" })).toBeVisible();
});

test("a refusal from the global door stays on the form, boat still chosen", async ({ page }) => {
  test.setTimeout(30_000);
  const title = `Global Door Full ${e2eNow().getTime()}`;
  const tripId = await scheduleTrip(page, title, 9, 1);

  await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
  await page.locator('input[name="fullName"]').filter({ visible: true }).fill("First Aboard Fay");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Diver added to the trip — but their waiver wasn’t emailed.",
  );

  // The boat is full now. The refusal comes back to the door that produced it,
  // still pointed at the same departure, so the next diver is one field away.
  await page.goto(`/shop/blue-mantis/bookings/new/${tripId}`);
  await page.locator('input[name="fullName"]').filter({ visible: true }).fill("Too Late Theo");
  await page.getByRole("button", { name: "Add to trip" }).click();

  await expect(page).toHaveURL(new RegExp(`/bookings/new/${tripId}\\?notice=diver-full`));
  // Next's own route announcer is also `role="alert"`, so target the banner.
  await expect(page.getByRole("alert").filter({ hasText: "That trip is full" })).toBeVisible();
  await expect(page.getByText(title).first()).toBeVisible();
});
