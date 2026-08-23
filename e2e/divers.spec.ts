import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openTripFromBoard,
  openTripTab,
  tripPathByTitle,
} from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

signedInAsOwner();

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  // The extended roster is well past one default page, sorted alphabetically —
  // search for her rather than assume she's on the unfiltered first page.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

  // The whole person cell is one link, so the initials avatar opens the diver
  // just like the name does.
  const row = page.getByRole("row").filter({ hasText: "Priya Sharma" });
  await row.getByText("PS", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").filter({ visible: true }).last();
  await expect(header.locator('a[href^="mailto:"]').filter({ visible: true })).toBeVisible();
  await expect(header.locator('a[href^="tel:"]').filter({ visible: true })).toBeVisible();
});

test("a diver's record shows their still-scheduled trips, linked straight to the manifest", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();

  const upcoming = page.getByRole("region", { name: "Upcoming trips" });
  await expect(upcoming).toBeVisible();
  const firstRow = upcoming.getByRole("link").first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/manifest$/);
});

/**
 * Currency, on the surface that shows the whole answer rather than a flag (ADR
 * 20260821-currency-is-what-catches-people).
 *
 * Priya dived **this season** — one of the three bands the roster deliberately
 * stays quiet about, so this line existing at all is the thing being asserted:
 * it is the difference between the diver record and every other surface. It
 * rides on the booking rather than the person, so it is read inside the
 * upcoming-trips row it was answered for.
 *
 * Nothing gates on it and nothing may start to; there is no state to drive
 * here, only a render.
 */
test("a diver's record states how long it has been, even when the roster would not", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const upcoming = page.getByRole("region", { name: "Upcoming trips" });
  await expect(upcoming.getByText("Last dived this season").first()).toBeVisible();
});

/**
 * The diver record is one ~6,400px scroll on a phone. Payments — the section a
 * staffer opens this page for when somebody is standing at the counter with a
 * bill — used to sit seventh, below "Book an activity", reachable only by
 * flicking. The sub-nav is the way down, and it is a plain hash jump: no route
 * change, no refetch, the whole record stays loaded behind it.
 */
test("the diver record's sub-nav jumps to a section without leaving the page", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?q=Talia");
  await page.getByRole("row").filter({ hasText: "Talia Rosen" }).getByText("TR").click();
  await expect(page.getByRole("heading", { level: 1, name: "Talia Rosen" })).toBeVisible();

  const subNav = page.getByRole("navigation", { name: "Diver record" });
  await expect(subNav).toBeVisible();

  const payments = page.getByRole("heading", { name: "Payments" });
  // Eighth of twelve sections: far below the fold on arrival.
  await expect(payments).not.toBeInViewport();

  await subNav.getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/divers\/[a-f0-9-]+#payments$/);
  await expect(payments).toBeInViewport();
  // Same document, not a navigation — the header never re-rendered away.
  await expect(page.getByRole("heading", { level: 1, name: "Talia Rosen" })).toBeAttached();

  // And back up, so the bar is a spine rather than a one-way trip.
  await subNav.getByRole("link", { name: "Certifications" }).click();
  await expect(page).toHaveURL(/#cards$/);
  await expect(page.getByRole("heading", { name: "Certification records" })).toBeInViewport();

  // The destructive tail is deliberately not a sub-nav target: deleting a
  // diver and erasing their personal data cost a scroll, on purpose.
  await expect(subNav.getByRole("link")).toHaveCount(8);
  await expect(subNav.getByRole("link", { name: /Erase|Delete/ })).toHaveCount(0);
});

test("a diver note is shared with the live boat manifest", async ({ page }) => {
  const note = `Briefing note ${e2eNow().getTime()}`;

  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const notes = page.getByRole("region", { name: "Diver notes" });
  await notes.getByLabel("Add a note").fill(note);
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes).toContainText(note);

  await page.getByRole("region", { name: "Upcoming trips" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/manifest$/);
  const row = page.locator("#roll-call-list li").filter({ hasText: "Priya Sharma" });
  await expect(row.getByText("Diver notes", { exact: true })).toBeVisible();
  await expect(row).toContainText(note);
});

// Task 144 (safety-adjacent — this prints on the manifest): Today used to
// tell staff to "ask at the counter" and link to a roster with no field to
// type it into. Covers both entry points, the incomplete-entry failure path,
// and that the diver's own record shares the same value the roster wrote.
test("staff record and correct a diver's emergency contact from the roster and the diver record, and it prints on the manifest", async ({
  page,
}) => {
  // Three real navigations (create, schedule, guests) plus a two-round
  // contact save and a diver-record round trip — past the suite's 15s
  // default, which is sized for a single flow, not this many.
  test.setTimeout(30_000);
  const stamp = e2eNow().getTime();
  const title = `Contact Capture Run ${stamp}`;
  const diverName = `Contact Diver ${stamp}`;

  await createTrip(page, {
    shopSlug: SHOP,
    title,
    date: daysFromNow(5),
    departsAt: "09:00",
    returnsAt: "12:00",
  });

  const tripPath = await tripPathByTitle(page, SHOP, title);
  await page.goto(`${tripPath}/guests`);
  await page.getByRole("link", { name: "Add a diver" }).click();
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill(diverName);
  await page.getByLabel("Email").fill(`contact-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/guests/);
  await expect(page.getByRole("status")).toContainText("Diver added to the trip");

  const card = page.locator("li").filter({ hasText: diverName });
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Failure path: a name with no phone is not a reachable contact — the
  // save must say so, not silently claim success or a generic error.
  await card.getByText("Add emergency contact").filter({ visible: true }).click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /name and a phone number/ }),
  ).toBeVisible();
  // Still reads as missing — a half-entered contact is not "on file".
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Complete it.
  await card.getByText("Add emergency contact").filter({ visible: true }).click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByLabel("Contact phone").fill("+1 305 555 0166");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
  ).toBeVisible();
  await expect(
    card.getByText("Robin Diver · +1 305 555 0166").filter({ visible: true }),
  ).toBeVisible();

  // The diver's own record reads the same value straight through
  // `updateDiver`/`saveBookingEmergencyContact` sharing the same columns —
  // one write path regardless of who fills it in.
  await card.getByRole("link", { name: diverName }).click();
  await page.getByText("Edit details").click();
  await expect(page.getByLabel("Emergency contact name")).toHaveValue("Robin Diver");
  await expect(page.getByLabel("Emergency contact phone")).toHaveValue("+1 305 555 0166");

  // Staff correct a wrong entry directly on the diver record.
  await page.getByLabel("Emergency contact name").fill("Casey Diver");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");

  // Reads on the manifest — behind the row's own "Contact & gear" disclosure
  // on screen (the print copy always carries it).
  await page.goto(`${tripPath}/manifest`);
  await page
    .locator("#roll-call-list li")
    .filter({ has: page.getByRole("heading", { name: diverName }) })
    .getByText("Contact & gear")
    .click();
  await expect(page.getByText("Casey Diver · +1 305 555 0166")).toBeVisible();
});

/**
 * **Which contacts a Guests card shows without being asked.**
 *
 * The roster's rule is work in the open, reference behind one tap. An
 * emergency contact is both, depending: a *missing* one is work — Today sends
 * staff here to collect it, and it prints on the manifest — while one already
 * on file is a fact about the seat.
 *
 * Both states shipped in the open for one release, and it cost every settled
 * card a heading, a value and an edit link it had no reason to show: a roster
 * of nine grew by ~830px, undoing most of what collapsing the cards was for.
 * A height check would be the obvious guard and the wrong one — it would fail
 * on any unrelated copy change. What actually matters is *which* card says it,
 * so that is what this asserts, on a seeded trip carrying one diver of each
 * kind and nothing freshly saved.
 */
test("a Guests card shows an emergency contact only when it is missing", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Guests");

  // Nadia Petrov is seeded with no contact (src/db/seed.ts `customerDefs`), so
  // her card states it where a staffer will act on it.
  const missing = page.locator("#roster li").filter({ hasText: "Nadia Petrov" });
  await expect(missing.getByText("Not on file").filter({ visible: true })).toBeVisible();
  await expect(missing.getByText("Add emergency contact").filter({ visible: true })).toBeVisible();

  // Tom Okafor has one on file. It must not be on the face of the card — but
  // it must still be *on* the card, one tap away, not dropped.
  const onFile = page.locator("#roster li").filter({ hasText: "Tom Okafor" });
  await expect(onFile.getByText(/Ngozi Okafor/)).toBeHidden();
  await openRosterDetails(onFile);
  await expect(onFile.getByText(/Ngozi Okafor/).filter({ visible: true })).toBeVisible();
});

/**
 * The roster paged forward-only by cursor: "Show more divers" and, once you
 * had moved, "Back to the top of the list" — so a staffer three pages into the
 * roster could only start over, and was never told how much roster was left.
 * It wears the shared pager now (ADR 20260803-one-pagination-model), and the
 * thing that spec must prove is the thing that was missing: going *back* one
 * page lands on the page you came from, not at the top.
 */
test("the roster pages both ways, and back one page is the page you came from", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  const pager = page.getByRole("navigation", { name: "Pages" });
  // Not "skip when there's nothing to page": the demo roster is well past one
  // page, so a missing pager is the regression, not a reason to pass.
  await expect(pager).toBeVisible();
  await expect(pager).toContainText(/Page 1 of \d+/);

  const firstName = await page.getByRole("row").nth(1).getByRole("link").first().textContent();

  await pager.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  const secondName = await page.getByRole("row").nth(1).getByRole("link").first().textContent();
  expect(secondName).not.toBe(firstName);

  // Forward once more, then back one — page 2 again, not page 1 and not the top.
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 3 of");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Previous" })
    .click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  expect(await page.getByRole("row").nth(1).getByRole("link").first().textContent()).toBe(
    secondName,
  );

  // A search resets to the first page rather than stranding the reader on a
  // page the narrowed result set does not have.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await expect(page.getByRole("row").filter({ hasText: "Priya Sharma" })).toBeVisible();
  await expect(page).not.toHaveURL(/page=/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The table hides sideways columns behind a scroll on a 390px screen, so
  // the list swaps to stacked cards there — everything readable, no scroll.
  test("the divers list stacks into cards and still opens the diver", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

    const card = page.getByRole("link", { name: /Priya Sharma/ });
    await expect(card).toBeVisible();
    // The card stacks the same two facts the table's columns carry, so the
    // second one has to be on it: the diver's certification level, or the
    // words that stand in when no unexpired card is on file. Matched as a set
    // rather than pinned to one level — this test is about the phone layout
    // carrying the column, not about which card this seeded diver holds.
    await expect(
      card.getByText(
        /Open Water|Advanced Open Water|Rescue Diver|Divemaster|Instructor|No current certification/,
      ),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
  });
});

/**
 * **Delete → find → restore.**
 *
 * Deletion has always been soft in the data (ADR 20260820-every-delete-is-soft),
 * and until the Deleted view existed it was not reversible in the product: the
 * roster's undo toast was twelve seconds long, and after that the diver matched
 * no search, sat in no view, and their record 404'd. A shop owner who deleted
 * the wrong person on Tuesday had no way to put them back on Wednesday — which
 * is the round trip this spec walks, deliberately *without* touching the toast.
 */
test("staff delete a diver, find them again in the Deleted view, and restore them", async ({
  page,
}) => {
  // Three navigations, a delete, a filtered search, and a restore — past
  // the suite's 15s default, which is sized for a single flow.
  test.setTimeout(30_000);
  const stamp = e2eNow().getTime();
  const diverName = `Deletable Diver ${stamp}`;

  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();
  const recordUrl = page.url().split("?")[0] ?? "";

  // Delete them from their own record.
  await page.getByText(`Delete ${diverName}`).click();
  await page.getByRole("button", { name: "Delete diver" }).click();
  // The land-then-undo toast, the app's one undo affordance — deliberately
  // left alone from here: the point of this spec is the path that still works
  // once it is gone.
  await expect(page.getByText("Diver deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  // Gone from the active roster, and not findable by searching it.
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  // The Deleted view is where they are, and search works inside it.
  await page.getByRole("link", { name: "Deleted", exact: true }).click();
  await expect(page).toHaveURL(/filter=removed/);
  const row = page.getByRole("row").filter({ hasText: diverName });
  await expect(row).toBeVisible();
  // And the row carries nothing to press. Every action on a diver lives on the
  // diver's own record; a list a staffer scans holds no consequential writes.
  await expect(row.getByRole("button")).toHaveCount(0);

  // Their record still opens — the restore has to have somewhere to live.
  await page.goto(recordUrl);
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();
  await expect(page.getByText("This diver is deleted")).toBeVisible();

  // Restore from the record, and they are back on the active roster.
  await page.getByRole("button", { name: "Restore diver" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Diver restored" })).toBeVisible();
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await expect(page.getByRole("row").filter({ hasText: diverName })).toBeVisible();
});

/**
 * **Erasure is offered on a deleted record and nowhere else.**
 *
 * It is the one control in the product with no undo, and it used to sit at the
 * foot of every diver's record — including the record a staffer opens to take a
 * payment. Deleting first is reversible, it is the state an erasure request
 * describes anyway, and it makes the one-way write a second decision rather
 * than a scroll (ADR 20260802-diver-data-erasure, 2026-08-21 amendment).
 *
 * Walked as an owner, the only role that may erase at all: for anyone else the
 * control is absent in both states and the test would prove nothing.
 */
test("erase is absent on a live diver's record and appears once they are deleted", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const diverName = `Erasable Diver ${e2eNow().getTime()}`;

  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();

  // Live: the destructive tail is Delete alone.
  await expect(page.getByRole("heading", { name: "Delete", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erase personal data" })).toBeHidden();

  await page.getByText(`Delete ${diverName}`).click();
  await page.getByRole("button", { name: "Delete diver" }).click();
  await expect(page.getByText("Diver deleted.")).toBeVisible();

  // Deleted: the record says so, and now offers the erase.
  await page.goto(`/shop/${SHOP}/divers?filter=removed&q=${encodeURIComponent(diverName)}`);
  await page.getByRole("row").filter({ hasText: diverName }).getByRole("link").first().click();
  await expect(page.getByText("This diver is deleted")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erase personal data" })).toBeVisible();
});

/**
 * **What the shop has done about this person**, on their own record.
 *
 * The activity trail always existed, and its only door was a departure — the
 * Guests tab's collapsed log, one boat at a time. So "what happened with this
 * diver?" could only be answered by remembering which trips they were on. Priya
 * is the seeded diver whose trail runs past one page (`seed-diver-trail.ts`),
 * which is what makes the section's pager a rendered thing here.
 */
test("a diver's record carries the shop's activity about them, paged", async ({ page }) => {
  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  // Seeded lines name the staffer and the diver, the shape `recordTripActivity`
  // writes — so the trail reads the same whether a row was seeded or earned.
  await expect(activity.getByRole("listitem").first()).toContainText("Priya Sharma");

  // The sub-nav reaches it without leaving the page — it is last on a very
  // long scroll.
  const nav = page.getByRole("navigation", { name: "Diver record" });
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "#activity");

  const firstLine = await activity.getByRole("listitem").first().textContent();
  await activity.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/activity=2/);
  await expect(
    page.getByRole("region", { name: "Activity", exact: true }).getByRole("listitem").first(),
  ).not.toHaveText(firstLine ?? "");
});

/**
 * **An outcome belongs beside the control that earned it.**
 *
 * The diver record is nine independent forms on one ~6,400px scroll, and every
 * one of their outcomes used to resolve into a single banner under the `<h1>`:
 * you saved a rental fit halfway down the page and the confirmation appeared
 * off-screen above you. Each section now renders its own (`resolveDiverNotice`
 * + `FormStatus`), which is a claim about *where* the text is, so the assertion
 * has to be about containment rather than mere presence.
 */
test("a section's outcome renders inside that section, not in a banner at the top", async ({
  page,
}) => {
  test.setTimeout(30_000);

  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const rentalFit = page.getByRole("region", { name: "Rental fit" });
  await rentalFit.scrollIntoViewIfNeeded();
  await rentalFit.getByLabel("BCD size").fill("M");
  await rentalFit.getByRole("button", { name: "Save rental fit" }).click();

  // Scoped to the region: the same text anywhere else on the page would not
  // satisfy this, which is the whole point of the change.
  await expect(rentalFit.getByText("Rental fit profile saved.")).toBeVisible();
  // And it is genuinely where the staffer is looking, not merely inside the
  // right DOM subtree.
  await expect(rentalFit.getByText("Rental fit profile saved.")).toBeInViewport();

  // A refusal lands on the box it is about, not beside the button and not at
  // the top: this email belongs to another active diver in the demo shop.
  await page.getByText("Edit details").click();
  const detailsForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save details" }) });
  await detailsForm.getByLabel("Email").fill("tom.okafor@example.com");
  await detailsForm.getByRole("button", { name: "Save details" }).click();

  // On the control (`Field`'s `error` wires `aria-invalid`/`aria-describedby`),
  // and inside the form — not in a banner two screens up.
  await expect(detailsForm.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(detailsForm.getByRole("alert")).toContainText(
    "Another diver already uses that email",
  );
  // The disclosure this form lives in is reopened by its own refusal: rendering
  // it inside a shut `<details>` would be worse than the banner it replaced.
  await expect(detailsForm.getByLabel("Email")).toBeVisible();
});

/**
 * **The quick-add reveal, on a phone, where the slide was wrong.**
 *
 * Typing the first character reveals an "Add <name>" button and the search
 * input slides left to make room — right at `sm` and up, where the input is a
 * fixed 20rem beside the button. Below it the input is full width in a clipped
 * row, so the same 250ms carried the whole focused search box across the
 * screen while somebody was typing into it (issue #781).
 *
 * Two things have to be true, and neither can be checked in jsdom — it
 * implements no `AnimationEvent` and resolves no media query.
 */
test.describe("the divers search on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  /**
   * Reading the *computed* duration rather than watching the box move: the
   * slide ends where the element started, so anything measured after it
   * finishes is identical either way, and measuring while it runs would be a
   * timing guess. This asks the browser what the rule resolves to at this
   * width, which is exact.
   */
  test("collapses the quick-add slide, and still lets the reveal settle", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    const search = page.getByRole("searchbox", { name: "Search divers" });
    await search.waitFor();

    const durationOfSlide = () =>
      page.evaluate(() => {
        const probe = document.createElement("div");
        probe.className = "animate-slide-in-right";
        document.body.append(probe);
        const duration = getComputedStyle(probe).animationDuration;
        probe.remove();
        return duration;
      });

    // `0.01ms`, as the browser prints it — the same collapse the reduced-motion
    // kill-switch uses, and short enough that nothing travels.
    expect(await durationOfSlide()).toBe("1e-05s");

    // **And the reveal still settles.** `animationend` is the only thing that
    // advances `entering -> visible`, so removing the animation instead of
    // shortening it would strand this button mid-state forever.
    await search.fill("Nora");
    const add = page.getByRole("button", { name: /Add/ }).first();
    await expect(add).toBeVisible();
    await expect(add.locator("xpath=ancestor::div[1]")).not.toHaveClass(/animate-slide-in-right/);

    // The desktop layout keeps the motion it was designed for.
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await durationOfSlide()).toBe("0.25s");
  });
});
