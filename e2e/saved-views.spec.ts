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

// Pinning a staffer's own view. Naming it used to be `window.prompt` — a
// blocking native dialog in the browser's language, not the shop's — and this
// spec is what proves the replacement is a real form in the page: the flow
// below never installs a `dialog` handler, so a prompt reappearing would hang
// the page and fail here rather than passing silently.
test("a staffer pins their own view from an in-page form and unpins it again", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const views = page.getByRole("navigation", { name: "Saved views" });

  await page.getByRole("searchbox", { name: "Search divers" }).fill(MISSING_CONTACT_DIVER);
  await expect(page).toHaveURL(/[?&]q=Nadia/);

  await views.getByRole("button", { name: "+ Save this view" }).click();
  const name = views.getByRole("textbox", { name: "Name this view" });
  await expect(name).toBeFocused();
  // Nothing typed yet, so there is nothing to save — the disabled state, not a
  // chip with an empty label.
  await expect(views.getByRole("button", { name: "Save view" })).toBeDisabled();

  await name.fill("Chasing contacts");
  await views.getByRole("button", { name: "Save view" }).click();

  // The chip carries the search it was pinned from, so following it restores
  // the roster the staffer actually saved.
  const chip = views.getByRole("link", { name: "Chasing contacts" });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("href", /q=Nadia/);
  // And it says where it lives, because a browser reset takes it.
  await expect(page.getByText("Saved on this device")).toBeVisible();

  // Clear the search rather than clicking "All divers": that chip deliberately
  // keeps the text query and only widens the filter, so it would leave `q=` in
  // the URL and the chip below would have nothing to restore.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("");
  await expect(page).toHaveURL(/\/divers$/);
  await chip.click();
  await expect(page).toHaveURL(/[?&]q=Nadia/);
  await expect(page.getByRole("row").filter({ hasText: MISSING_CONTACT_DIVER })).toHaveCount(1);

  await views.getByRole("button", { name: "Remove saved view Chasing contacts" }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByText("Saved on this device")).toHaveCount(0);
});
