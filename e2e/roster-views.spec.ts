import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * READ_ONLY holds here: the view chips are links and the search box drives the URL —
 * every assertion is about which rows the roster query returns.
 */

// The roster's view chips (`?filter=`). The bug class this exists to catch is a
// chip that decorates the URL and nothing else: the page reads
// `searchParams.filter`, hands it to `listDiverSummaries`, and one dropped
// argument anywhere along that path leaves the full roster on screen under a
// highlighted chip. So every chip is checked against roster *content* — a
// seeded diver it must keep and a seeded diver it must drop — not just against
// the query string it put in the address bar.
signedInAsOwner();

// Seeded divers on opposite sides of each view (src/db/seed.ts `customerDefs`,
// whose order is load-bearing and documented as such):
//
// - Nadia Petrov is one of the divers deliberately left without an emergency
//   contact; Priya Sharma has one on file.
// - Priya (customer 0) is on today's boat. Hana Kobayashi (customer 12) is
//   deliberately left without a booking, so she is not part of today's view.
// - Mateo Duarte (customer 13) carries a pending open-water card, which is
//   exactly what "Needs attention" asks about.
const MISSING_CONTACT_DIVER = "Nadia Petrov";
const CONTACT_ON_FILE_DIVER = "Priya Sharma";
const DIVING_TODAY_DIVER = "Priya Sharma";
const DIVING_LATER_DIVER = "Hana Kobayashi";
const PENDING_CARD_DIVER = "Mateo Duarte";
// Priya's cards are verified, so nothing of hers is waiting on a staffer: she
// is the roster's "not in this view, but still on the roster" case. That a
// clear row wears no badge at all is pinned deterministically in
// `DiverList.test.tsx`, where the row's own facts are the fixture.
const SETTLED_DIVER = "Priya Sharma";

test("the diver roster offers role-view chips that drive the filter", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await expect(page.getByRole("heading", { level: 1, name: "Divers" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Roster views" });
  const search = page.getByRole("searchbox", { name: "Search divers" });
  // The roster is one ledger now: a row is an `<li>` whose stretched link is
  // named for the diver (ADR 20260827-people-not-lists). There is one of them
  // per diver at every width — there used to be two, a phone card and a
  // desktop table row, and every assertion here had to say which it meant.
  const rowFor = (name: string) => page.getByRole("listitem").filter({ hasText: name });

  await views.getByRole("link", { name: "Missing contact" }).click();
  await expect(page).toHaveURL(/filter=missing_contact/);
  // Each diver is looked for by name rather than scanned for in the list: the
  // roster is alphabetical and pages at 10 (DIVER_PAGE_SIZE), so "is this
  // diver in this view" is only a decidable question when the view is narrowed
  // to them. Search and filter share one URL builder (DiverList's `hrefFor`),
  // which is what keeps the chip's filter on through each search below.
  await search.fill(MISSING_CONTACT_DIVER);
  await expect(page).toHaveURL(
    /[?&]q=Nadia.*filter=missing_contact|filter=missing_contact.*q=Nadia/,
  );
  await expect(rowFor(MISSING_CONTACT_DIVER)).toHaveCount(1);

  await search.fill(CONTACT_ON_FILE_DIVER);
  await expect(page).toHaveURL(/[?&]q=Priya/);
  // On the roster, but not in this view — the assertion that fails if the page
  // ever decorates the URL and hands the unfiltered roster back anyway.
  await expect(rowFor(CONTACT_ON_FILE_DIVER)).toHaveCount(0);
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  await search.fill("");
  await expect(page).toHaveURL(/\/divers\?filter=missing_contact$/);
  await views.getByRole("link", { name: "All divers" }).click();
  await expect(page).toHaveURL(/\/divers$/);
  // Priya is back — proof the view above dropped her rather than the roster
  // having lost her.
  await search.fill(CONTACT_ON_FILE_DIVER);
  await expect(page).toHaveURL(/[?&]q=Priya/);
  await expect(page).not.toHaveURL(/filter=/);
  await expect(rowFor(CONTACT_ON_FILE_DIVER)).toHaveCount(1);
});

// The two views the counter actually opens the roster for. Both rest on facts
// that live off the row — a seat on a boat, a card waiting on a staffer — so
// each is checked the same way: a diver the view must keep, and a diver on the
// roster it must drop.
test("the roster narrows to today's divers and to whoever needs a staffer", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const views = page.getByRole("navigation", { name: "Roster views" });
  const search = page.getByRole("searchbox", { name: "Search divers" });
  // The roster is one ledger now: a row is an `<li>` whose stretched link is
  // named for the diver (ADR 20260827-people-not-lists). There is one of them
  // per diver at every width — there used to be two, a phone card and a
  // desktop table row, and every assertion here had to say which it meant.
  const rowFor = (name: string) => page.getByRole("listitem").filter({ hasText: name });

  await views.getByRole("link", { name: "Diving today" }).click();
  await expect(page).toHaveURL(/filter=diving_today/);
  await search.fill(DIVING_TODAY_DIVER);
  await expect(rowFor(DIVING_TODAY_DIVER)).toHaveCount(1);
  // A seat on a boat that sails another day is not today's work.
  await search.fill(DIVING_LATER_DIVER);
  await expect(rowFor(DIVING_LATER_DIVER)).toHaveCount(0);
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  // Clearing the box and tapping a chip straight after is the sequence that
  // used to race: the search drives the URL through a 250ms debounce, and the
  // pending timer would land after the chip and restore the view just left
  // (fixed in DiverList's `cancelPendingSearch`). Asserted here without a wait
  // in between on purpose — a `waitFor` would hide the regression rather than
  // catch it. The URL check below is what fails if the chip is undone.
  await search.fill("");
  await views.getByRole("link", { name: "Needs attention" }).click();
  await expect(page).toHaveURL(/\/divers\?filter=needs_attention$/);
  await search.fill(PENDING_CARD_DIVER);
  await expect(rowFor(PENDING_CARD_DIVER)).toHaveCount(1);

  /**
   * **The chip is what says why, and the rows say nothing** (ADR
   * 20260827-people-not-lists, decision 2). Every diver in this view has a card
   * waiting on a staffer, so a badge repeating that on each row would be the
   * view's own shared fact at row volume — the roster badges exceptions only.
   *
   * So the assertion moved from the badge to the membership: a settled diver is
   * *not* in the view and *is* on the roster, which is what a chip that
   * decorates the URL and hands back the unfiltered roster would fail.
   */
  await search.fill(SETTLED_DIVER);
  await expect(rowFor(SETTLED_DIVER)).toHaveCount(0);
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  await views.getByRole("link", { name: "All divers" }).click();
  await expect(page).toHaveURL(/\/divers\?q=/);
  await expect(rowFor(SETTLED_DIVER)).toHaveCount(1);
});
