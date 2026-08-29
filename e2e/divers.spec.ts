import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  manifestRow,
  openManifestPerson,
  openRosterDetails,
  openTripFromBoard,
  openTripTab,
  tripPathByTitle,
} from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

signedInAsOwner();

test("staff opens a diver from the roster row and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  // The extended roster is well past one default page, sorted alphabetically —
  // search for her rather than assume she's on the unfiltered first page.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

  // The row *is* the door (ADR 20260827-people-not-lists): one stretched link
  // named for the diver, so a tap anywhere along the row opens their record.
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").filter({ visible: true }).last();
  await expect(header.locator('a[href^="mailto:"]').filter({ visible: true })).toBeVisible();
  await expect(header.locator('a[href^="tel:"]').filter({ visible: true })).toBeVisible();
});

/**
 * The story is one ledger: a seat appears exactly once, soonest first, and a
 * departure still ahead opens the manifest — which is where the work about a
 * boat that has not left happens (ADR 20260827-people-not-lists).
 */
test("a diver's record tells one story, and a departure still ahead opens the manifest", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();

  const story = page.getByRole("region", { name: "The story" });
  await expect(story).toBeVisible();
  await story.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/manifest$/);
});

/**
 * The story leads with what is still ahead. A diver with a seat on a departure
 * this shop has not yet run reads that row first, above everything behind
 * them — the ledger is one chronological run, not two lists.
 */
test("a diver's record puts the boat they are on at the top of the story", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const story = page.getByRole("region", { name: "The story" });
  await expect(story.getByRole("link").first()).toBeVisible();
});

/**
 * **The record's one idea, and its one primary** (ADR
 * 20260827-people-not-lists, decision 1). The jump nav that used to lead this
 * page is gone with the ten sections it indexed: the record is a masthead, a
 * status ledger, a story and four inset groups, and the only filled control on
 * it is Book a departure.
 *
 * The status ledger's fix is a fragment onto the control that does the work,
 * so "Verify it" both scrolls to and focuses the Verify button — no JavaScript,
 * no route change.
 */
test("the record leads with what is open, and offers exactly one primary act", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // The retired spine, in both of its spellings.
  await expect(page.getByRole("navigation", { name: "Diver record" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Specialty certifications" })).toHaveCount(0);

  // One primary, and it discloses the picker in place rather than navigating.
  const book = page.getByText("Book a departure", { exact: true });
  await expect(book).toBeVisible();
  await expect(page.getByLabel("Course or dive")).toBeHidden();
  await book.click();
  await expect(page.getByLabel("Course or dive")).toBeVisible();
});

/**
 * **S1 — fix a diver before the boat.** The status ledger names the open item
 * and carries the one fix beside it; taking that fix lands on the control in
 * the certifications group.
 */
test("the status ledger's fix lands on the control that clears it", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?filter=needs_attention");
  await page.locator("main ul li a").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const fix = page.getByRole("link", { name: "Verify it" });
  await expect(fix).toBeVisible();
  await expect(fix).toHaveAttribute("href", "#card-awaiting");
  await fix.click();
  await expect(page.locator("#card-awaiting")).toBeInViewport();
});

test("a diver note is shared with the live boat manifest", async ({ page }) => {
  const note = `Briefing note ${e2eNow().getTime()}`;

  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const notes = page.getByRole("region", { name: "Diver notes" });
  await notes.getByLabel("Add a note").fill(note);
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes).toContainText(note);

  await page.getByRole("region", { name: "The story" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/manifest$/);
  // The desk's note reads in the person's own panel, one tap from the row
  // (ADR 20260827-the-departure-is-two-working-surfaces, decision 2).
  const row = manifestRow(page, "Priya Sharma");
  await openManifestPerson(row);
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
  await page.goto(`${tripPath}`);
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill(diverName);
  await page.getByLabel("Email").fill(`contact-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
  await expect(page.getByRole("status")).toContainText("Diver added to the trip");

  const card = page.locator("li").filter({ hasText: diverName });
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Failure path: a name with no phone is not a reachable contact — the
  // save must say so, not silently claim success or a generic error.
  await card.getByText("Emergency contact · Not on file").filter({ visible: true }).click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /name and a phone number/ }),
  ).toBeVisible();
  // Still reads as missing — a half-entered contact is not "on file".
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Complete it.
  await card.getByText("Emergency contact · Not on file").filter({ visible: true }).click();
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

  // Reads on the manifest — behind the row's own person panel on screen (the
  // print copy always carries it). Reference text, never a `tel:` link: there
  // are no call buttons anywhere on the boat (decision 3).
  await page.goto(`${tripPath}/manifest`);
  const manifestDiverRow = manifestRow(page, diverName);
  await openManifestPerson(manifestDiverRow);
  await expect(manifestDiverRow.getByText("Casey Diver ·")).toBeVisible();
  await expect(manifestDiverRow.locator('a[href^="tel:"]')).toHaveCount(0);
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
  await openTripTab(page, "Trip");

  // Nadia Petrov is seeded with no contact (src/db/seed.ts `customerDefs`), so
  // her card states it where a staffer will act on it.
  const missing = page.locator("#roster li").filter({ hasText: "Nadia Petrov" });
  // One warning line, its fix riding the end (slice 5d): the sentence and
  // the "Add" word share the clickable summary that opens the form.
  await expect(
    missing.getByText("Emergency contact · Not on file").filter({ visible: true }),
  ).toBeVisible();
  await expect(missing.getByText("Add", { exact: true }).filter({ visible: true })).toBeVisible();

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

  // The row's link carries the diver's name as its accessible name — the row
  // text itself sits behind the stretched overlay (`LedgerRow`).
  const firstName = await page.locator("main ul li a").first().getAttribute("aria-label");

  await pager.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  const secondName = await page.locator("main ul li a").first().getAttribute("aria-label");
  expect(secondName).not.toBe(firstName);

  // Forward once more, then back one — page 2 again, not page 1 and not the top.
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 3 of");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Previous" })
    .click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  expect(await page.locator("main ul li a").first().getAttribute("aria-label")).toBe(secondName);

  // A search resets to the first page rather than stranding the reader on a
  // page the narrowed result set does not have.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await expect(page.getByRole("link", { name: "Priya Sharma", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/page=/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * **One rendering at every width** (ADR 20260827-people-not-lists, decision
   * 2). The roster used to draw a stacked card list under `sm` and a
   * three-column table above it: the same page of divers twice in the DOM, one
   * copy CSS-hidden, and every assertion about the roster obliged to say which
   * one it meant. So this test's job changed from "the phone gets the other
   * layout" to "there is no other layout" — the ledger at 390 is the ledger at
   * 1440, and the row is still the door.
   */
  test("the roster is one ledger at 390, and the row still opens the diver", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

    const row = page.getByRole("link", { name: "Priya Sharma", exact: true });
    await expect(row).toHaveCount(1);
    await expect(page.getByRole("table")).toHaveCount(0);
    // Her letter heads the run she is in, and states itself once — the shared
    // fact belongs to the group header, never to the rows.
    await expect(page.getByRole("heading", { level: 2, name: "P", exact: true })).toHaveCount(1);

    await row.click();
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
  const row = page.getByRole("listitem").filter({ hasText: diverName });
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
  await expect(page.getByRole("link", { name: diverName, exact: true })).toBeVisible();
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

  // Live: the destructive tail is Delete alone. The delete section carries no
  // heading of its own — "Delete" above a disclosure reading "Delete <name>"
  // named the same act twice (issue #779) — so the disclosure is the anchor.
  await expect(page.getByText(`Delete ${diverName}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erase personal data" })).toBeHidden();

  await page.getByText(`Delete ${diverName}`).click();
  await page.getByRole("button", { name: "Delete diver" }).click();
  await expect(page.getByText("Diver deleted.")).toBeVisible();

  // Deleted: the record says so, and now offers the erase.
  await page.goto(`/shop/${SHOP}/divers?filter=removed&q=${encodeURIComponent(diverName)}`);
  await page.getByRole("link", { name: diverName, exact: true }).click();
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
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Folded: it is the reference a staffer scrolls to, not the errand that
  // brought them here (ADR 20260827-people-not-lists). The fold is a native
  // `<details>`, so opening it is a tap on its own summary and nothing else.
  const activity = page.locator("details").filter({ hasText: "Activity" }).last();
  await activity.getByText("Activity", { exact: true }).click();
  // Seeded lines name the staffer and the diver, the shape `recordTripActivity`
  // writes — so the trail reads the same whether a row was seeded or earned.
  await expect(activity.getByRole("listitem").first()).toContainText("Priya Sharma");

  const firstLine = await activity.getByRole("listitem").first().textContent();
  await activity.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/activity=2/);
  // Page two arrives with the group already open — the pager's links carry
  // `#activity`, and landing on a shut disclosure would hide the page the
  // reader just asked for.
  await expect(
    page.locator("details").filter({ hasText: "Activity" }).last().getByRole("listitem").first(),
  ).not.toHaveText(firstLine ?? "");
});

/**
 * **An outcome belongs beside the control that earned it.**
 *
 * The record is several independent forms on one page, and every one of their
 * outcomes used to resolve into a single banner under the `<h1>`: you saved a
 * fit halfway down and the confirmation appeared off-screen above you. Each
 * group now renders its own (`resolveDiverNotice` + `FormStatus`), which is a
 * claim about *where* the text is, so the assertion has to be about
 * containment rather than mere presence.
 */
test("a section's outcome renders inside that section, not in a banner at the top", async ({
  page,
}) => {
  test.setTimeout(30_000);

  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const gear = page.getByRole("region", { name: "Gear and sizes" });
  await gear.scrollIntoViewIfNeeded();
  // The two facts lead; the nine-control form is behind the group's one
  // disclosure (ADR 20260827-people-not-lists, "edit in place").
  await gear.getByText("Edit", { exact: true }).click();
  await gear.getByLabel("BCD size").fill("M");
  await gear.getByRole("button", { name: "Save rental fit" }).click();

  // Scoped to the region: the same text anywhere else on the page would not
  // satisfy this, which is the whole point of the change.
  await expect(gear.getByText("Rental fit profile saved.")).toBeVisible();
  // And it is genuinely where the staffer is looking, not merely inside the
  // right DOM subtree.
  await expect(gear.getByText("Rental fit profile saved.")).toBeInViewport();

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
 * **The search row on a phone, where nothing may move.**
 *
 * Typing the first character used to mount an "Add diver" button and slide the
 * search input sideways to make room. At `sm` and up the input is a fixed 20rem
 * beside the button and that read as the button pushing it aside; below it the
 * input is full width, so the same 250ms carried the whole focused search box
 * across the screen while somebody was typing into it (issue #781), and the
 * button popping in beside it was the other half of the report (issue #782).
 *
 * The button is on screen from first paint now, so the row is static. That is a
 * claim about geometry across a state change, which jsdom cannot answer —
 * nothing there lays anything out.
 */
test.describe("the divers search on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("keeps the add-diver door on screen from first paint, and the search box still", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/divers");
    const search = page.getByRole("searchbox", { name: "Search divers" });
    await search.waitFor();

    // Nothing typed: the same words, leading to the full form rather than to a
    // quick-add with nothing to add from.
    const openForm = page.getByRole("link", { name: "Add diver" });
    await expect(openForm).toBeVisible();
    await expect(openForm).toHaveAttribute("href", "/shop/blue-mantis/divers/new");
    const before = await search.boundingBox();

    await search.fill("Nora");
    // Awaiting the swap, not a duration: the link becomes a submit button, and
    // that assertion is what makes the measurement below deterministic.
    await expect(page.getByRole("button", { name: "Add diver" })).toBeVisible();
    await expect(openForm).toHaveCount(0);

    // The box a staffer is typing into is exactly where it was.
    expect(await search.boundingBox()).toEqual(before);
  });
});
