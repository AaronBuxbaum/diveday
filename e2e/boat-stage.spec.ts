import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * **The boat says where it is** — ADR 20260904-reef-all-the-way-down, decision
 * 2, Budget rule 4.
 *
 * One tap at the rail reaches three surfaces: the shop home's station chip,
 * the shop's own public schedule, and every diver's link. The loop is worth
 * running end to end rather than asserting per surface, because the value of
 * the feature *is* that one act shows up in three places — and because the
 * public half is the only operational fact this app publishes to a visitor
 * who is not signed in.
 */
test("a tap on the manifest reaches the home and the public schedule", async ({ page }) => {
  // Board → trip → manifest, one write, then two more full page reads.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);

  const headingIn = page.getByRole("button", { name: "Heading in", exact: true });
  await headingIn.click();
  // The strip's own pressed state is the crew's receipt, and it is what the
  // server sent back rather than an optimistic paint.
  await expect(headingIn).toHaveAttribute("aria-pressed", "true");

  // The home's station chip carries the same word.
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText(/Heading in · /).first()).toBeVisible();

  // The shop's own website says it too, to a visitor who is not signed in.
  const visitor = await page.context().browser()?.newContext();
  if (!visitor) throw new Error("no browser to open a signed-out context with");
  try {
    const publicPage = makeActivitySafe(await visitor.newPage());
    await publicPage.goto(`${page.url().split("/shop/")[0]}/s/blue-mantis`);
    await expect(publicPage.getByText(/is heading in\./).first()).toBeVisible();
  } finally {
    await visitor.close();
  }
});

/**
 * `home` is the one stage the storefront does not publish: "back at the dock"
 * is a shop's reading of a day that is over, and a public page about tomorrow
 * has no use for it. The diver's own link still says it — that diver was on
 * the boat.
 */
test("the public schedule stops naming a boat once it is home", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);

  const home = page.getByRole("button", { name: "Home", exact: true });
  await home.click();
  await expect(home).toHaveAttribute("aria-pressed", "true");

  const visitor = await page.context().browser()?.newContext();
  if (!visitor) throw new Error("no browser to open a signed-out context with");
  try {
    const publicPage = makeActivitySafe(await visitor.newPage());
    await publicPage.goto(`${page.url().split("/shop/")[0]}/s/blue-mantis`);
    // The page's own heading is the signal that it rendered; the absence
    // below is then a real absence rather than an unloaded page.
    await publicPage.getByRole("heading", { level: 1 }).first().waitFor();
    await expect(publicPage.getByText(/is back at the dock\./)).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});
