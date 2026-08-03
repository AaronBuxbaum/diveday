import { expect, signedInAsOwner, test } from "./fixtures";

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
// - Priya (customer 0) is on today's boat. Amara Osei (customer 10) is one of
//   the "later sailings carry their own regulars" group, so she holds a seat,
//   but not one that sails today.
// - Mateo Duarte (customer 13) carries a pending open-water card, which is
//   exactly what "Needs attention" asks about.
const MISSING_CONTACT_DIVER = "Nadia Petrov";
const CONTACT_ON_FILE_DIVER = "Priya Sharma";
const DIVING_TODAY_DIVER = "Priya Sharma";
const DIVING_LATER_DIVER = "Amara Osei";
const PENDING_CARD_DIVER = "Mateo Duarte";

test("the diver roster offers role-view chips that drive the filter", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  await expect(page.getByRole("heading", { level: 1, name: "Divers" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Roster views" });
  const search = page.getByRole("searchbox", { name: "Search divers" });
  const rowFor = (name: string) => page.getByRole("row").filter({ hasText: name });

  await views.getByRole("link", { name: "Missing contact" }).click();
  await expect(page).toHaveURL(/filter=missing_contact/);
  await expect(page.getByRole("heading", { name: /People/ })).toBeVisible();
  // Each diver is looked for by name rather than scanned for in the list: the
  // roster is alphabetical and pages at 20 (DIVER_PAGE_SIZE), so "is this
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
test("the roster narrows to today's divers and to whoever needs a staffer", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const views = page.getByRole("navigation", { name: "Roster views" });
  const search = page.getByRole("searchbox", { name: "Search divers" });
  const rowFor = (name: string) => page.getByRole("row").filter({ hasText: name });

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
  const flagged = rowFor(PENDING_CARD_DIVER);
  await expect(flagged).toHaveCount(1);
  // The view and the row's own badge are read off the same evidence, so a
  // diver in here always has something on screen saying why.
  await expect(flagged.getByText(/pending review|to confirm/)).toBeVisible();

  // And nobody settled is in it. Asserted over the whole page rather than
  // against one more hard-coded seed index: the "Attention" cell reads "None"
  // for a diver with nothing waiting, so a single "None" anywhere in this view
  // is a diver the WHERE clause should have dropped.
  await search.fill("");
  await expect(page).toHaveURL(/\/divers\?filter=needs_attention$/);
  await expect(page.getByRole("cell", { name: "None", exact: true })).toHaveCount(0);

  // ...and the check above is not vacuous: the unfiltered roster is full of them.
  await views.getByRole("link", { name: "All divers" }).click();
  await expect(page).toHaveURL(/\/divers$/);
  expect(await page.getByRole("cell", { name: "None", exact: true }).count()).toBeGreaterThan(0);
});
