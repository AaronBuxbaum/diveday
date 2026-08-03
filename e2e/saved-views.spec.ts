import { expect, signedInAsOwner, test } from "./fixtures";

// The roster's built-in view chips (`?filter=`). The bug class this exists to
// catch is a chip that decorates the URL and nothing else: the page reads
// `searchParams.filter`, hands it to `listDiverSummaries`, and one dropped
// argument anywhere along that path leaves the full roster on screen under a
// highlighted chip. So every chip is checked against roster *content* — a
// seeded diver it must keep and a seeded diver it must drop — not just against
// the query string it put in the address bar.
signedInAsOwner();

// Two seeded divers on opposite sides of the "Missing contact" view
// (src/db/seed.ts `customerDefs`): Nadia Petrov is one of the eight deliberately
// left without an emergency contact, Priya Sharma has one on file. No seeded
// diver carries dive insurance at all, which is what makes "Has insurance" the
// empty view below.
const MISSING_CONTACT_DIVER = "Nadia Petrov";
const CONTACT_ON_FILE_DIVER = "Priya Sharma";

test("the diver roster offers role-view chips that drive the filter", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  await expect(page.getByRole("heading", { level: 1, name: "Divers" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Saved views" });
  const search = page.getByRole("searchbox", { name: "Search divers" });
  const rowFor = (name: string) => page.getByRole("row").filter({ hasText: name });

  await views.getByRole("link", { name: "Missing contact" }).click();
  await expect(page).toHaveURL(/filter=missing_contact/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
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
  await views.getByRole("link", { name: "Has insurance" }).click();
  await expect(page).toHaveURL(/filter=insured/);
  // Nobody on the seeded roster has a policy recorded, so the honest result is
  // an empty view — a whole roster disappearing is the loudest evidence the
  // WHERE clause ran.
  await expect(page.getByText("No divers match this view.")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(0);

  await views.getByRole("link", { name: "All divers" }).click();
  await expect(page).toHaveURL(/\/divers$/);
  // Priya is back — proof the views above dropped her rather than the roster
  // having lost her.
  await search.fill(CONTACT_ON_FILE_DIVER);
  await expect(page).toHaveURL(/[?&]q=Priya/);
  await expect(page).not.toHaveURL(/filter=/);
  await expect(rowFor(CONTACT_ON_FILE_DIVER)).toHaveCount(1);
});
