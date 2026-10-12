import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * **The boat says where it is** — ADR 20260904-reef-all-the-way-down, decision
 * 2, Budget rule 4.
 *
 * One tap at the rail reaches the shop home's station chip and every diver's
 * link. The storefront no longer publishes a boat's stage to a visitor who is
 * not signed in: the public live line was cut with follow-the-boat (ADR
 * 20261001-logbook, decision 7), so this also holds the public schedule to
 * saying nothing about it.
 */
test("a tap on the manifest reaches the home and stays off the public schedule", async ({
  page,
}) => {
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

  // The home's station card wears the same word as its pill, the manifest
  // strip's own word, with "since 9:42 AM" beside it (UX review 2026-10-10,
  // item 1). Scoped to this departure's card, the innermost list item that
  // holds its title link.
  await page.goto("/shop/blue-mantis");
  const station = page
    .locator("li")
    .filter({ has: page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }) })
    .last();
  await expect(station.getByText("Heading in", { exact: true })).toBeVisible();
  await expect(station.getByText(/^since \d/)).toBeVisible();

  const visitor = await page.context().browser()?.newContext();
  if (!visitor) throw new Error("no browser to open a signed-out context with");
  try {
    const publicPage = makeActivitySafe(await visitor.newPage());
    await publicPage.goto(`${page.url().split("/shop/")[0]}/s/blue-mantis`);
    // The page's own heading is the signal that it rendered; the absence
    // below is then a real absence rather than an unloaded page.
    await publicPage.getByRole("heading", { level: 1 }).first().waitFor();
    await expect(publicPage.getByText(/is heading in\./)).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});
