import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("live manifest retains blocked divers and records an explicit not-boarded result", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Readiness needs attention" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers (the seed
  // reef trip has none ready), so there is nothing to board.
  await expect(page.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);

  await page.locator("#roll-call-list").scrollIntoViewIfNeeded();
  const checkpointScroll = await page.evaluate(() => window.scrollY);
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  // After a dive, roll call is a physical head count — a blocked diver who is
  // aboard can still be recorded present, so boarding is offered here.
  await expect(page.getByRole("button", { name: "Mark boarded" }).first()).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - checkpointScroll))
    .toBeLessThan(100);
  await page
    .getByRole("link", { name: "Before departure" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=departure/);

  await page.getByText("Add a note to this roll-call record").first().click();
  await page.getByLabel("Optional note").first().fill("Guest asked to sit out before departure.");
  // Park the button clear of the sticky header and progress panel before
  // sampling. Playwright scrolls a target into view as part of clicking it, so
  // a button sitting under those overlays moves the page after the sample and
  // the comparison is then against a position the user was never at.
  const markNotBoarded = page.getByRole("button", { name: "Mark not boarded" }).first();
  await markNotBoarded.evaluate((button) => button.scrollIntoView({ block: "center" }));
  const rollCallScroll = await page.evaluate(() => window.scrollY);
  await markNotBoarded.click();
  // WP-6: the card settles in place — the button flips to the confirmed state
  // without a full-page redirect, so the roster position never jumps.
  await expect(page.getByRole("button", { name: "Not boarded ✓" }).first()).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - rollCallScroll))
    .toBeLessThan(100);
  await expect(page).not.toHaveURL(/#roll-call-/);
  await expect(page.getByText("Not boarded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("button", { name: "Not boarded ✓" })).toHaveCount(2);
});

test("captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  await page.getByRole("button", { name: "Save for offline" }).click();
  await expect(page.getByText(/Saved\. Open the offline roll call/)).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  // Offline reload serves the device copy; its freshness badge reads
  // "Fresh copy".
  await expect(page.getByText("Fresh copy")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  // Two live regions exist here (the action message and the connectivity
  // badge); scope to the one carrying the sync message.
  await expect(
    page.getByRole("status").filter({ hasText: "when you're back in service" }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "caught up" })).toBeVisible();
});
