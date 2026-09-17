import { expect, test } from "./fixtures";

/**
 * **The settings editors that outgrew a hub row.**
 *
 * The settings hub is a directory: a row states its current answer and opens
 * the form that changes it (ADR 20260827-clearwater-surface-language, decision
 * 6). Four rows had stopped obeying that — their "form" was a *list* of forms,
 * each line carrying its own Save and Delete, behind one `⌄`. They are pages
 * now, and the hub lists them as doors.
 *
 * What this guards is the join the unit suite cannot see: that each door goes
 * where it says, that the editor still writes through the same action it always
 * did, and — the part a move like this actually breaks — that the action's
 * redirect lands the shop back on the page they were working on rather than at
 * the top of the hub.
 *
 * `e2e/season-events.spec.ts` covers the seasons page's own flow end to end
 * (a season the shop writes, and the storefront reading it), so it is not
 * repeated here.
 *
 * Every test takes a **shop of its own**. Boats, kinds of day and dive packages
 * are shop *configuration*, which `resetDemoSchedule` deliberately leaves
 * standing — a hull written into blue-mantis would survive into whatever spec
 * this worker runs next, including the captures that photograph that shop
 * (ADR 20260815-per-test-private-shops).
 */

test("the hub's four editors are doors, and each opens its own page", async ({
  page,
  privateShop,
}) => {
  // A mint and a live sign-in before the first assertion.
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings`);

  const main = page.getByRole("main");
  for (const [name, segment] of [
    ["Boats", "boats"],
    ["Kinds of day", "kinds-of-day"],
    ["Seasons and events", "seasons"],
    ["Dive packages", "dive-packages"],
  ] as const) {
    await expect(main.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      `/shop/${SHOP}/settings/${segment}`,
    );
  }

  // And the hub is a directory: none of the four editors' controls is on it.
  await expect(main.getByRole("button", { name: "Add a boat" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Add package" })).toHaveCount(0);
});

test("a hull is added on its own page, and the save lands back on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings/boats`);
  await expect(page.getByRole("heading", { level: 1, name: "Boats" })).toBeVisible();
  // The way back up is the eyebrow, never a "Back to settings" button.
  await expect(page.getByRole("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    `/shop/${SHOP}/settings`,
  );

  const addForm = page
    .getByRole("main")
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Add a boat" }) });
  await addForm.getByLabel("Boat name").fill("Second Wind");
  await addForm.getByLabel("Capacity (seats)").fill("12");
  await addForm.getByRole("button", { name: "Add a boat" }).click();

  // The action's own redirect lands back on this page rather than at the top of
  // the hub. Asserted on the banner and the heading, not on the URL: this page
  // clears its own `?notice=` client-side once shown (`FlashParams`), so a URL
  // assertion races that cleanup.
  await expect(page.getByText("Boat created.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Boats" })).toBeVisible();
  await expect(page.getByRole("main").locator('input[value="Second Wind"]')).toHaveCount(1);
});

test("a package is added on its own page, and the save lands back on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings/dive-packages`);
  await expect(page.getByRole("heading", { level: 1, name: "Dive packages" })).toBeVisible();

  await page.getByLabel("What you call it").fill("Ten-dive card");
  await page.getByLabel("Dives included").fill("10");
  await page.getByLabel("Price").fill("450");
  await page.getByRole("button", { name: "Add package" }).click();

  await expect(page.getByText("Package added.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Dive packages" })).toBeVisible();
  await expect(page.getByText("Ten-dive card")).toBeVisible();
});
