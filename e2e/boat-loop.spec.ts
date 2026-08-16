import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * Not READ_ONLY, despite neither test submitting anything: both start by
 * clicking "Board divers" off Today's queue, which only renders while
 * blue-mantis has a departure scheduled today. That's a claim about seeded
 * *state*, not about writes, and READ_ONLY only ever promises the latter — a
 * read-only test skips its own reset and inherits whatever the previous
 * same-worker test left behind, so a sibling spec that cancels or moves
 * today's only departure leaves this one staring at "No boats out today"
 * with nothing to click (observed on CI: run 31913664714, shard 1/4, the
 * page snapshot at timeout showed exactly that empty state). Paying the
 * reset restores the invariant these tests actually depend on.
 */

signedInAsOwner();

test("the trip sub-nav reaches all four surfaces", async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // Today's departure card drops staff straight onto the manifest's boarding pass.
  await page.getByRole("link", { name: "Board divers" }).first().click();
  await expect(page).toHaveURL(/\/manifest/);

  const boatMode = page.getByRole("group", { name: "Boat mode" });
  await expect(boatMode).toBeVisible();
  const distanceFromPageEnd = await boatMode.evaluate((element) => {
    element.scrollIntoView({ block: "end" });
    const scrolling = document.scrollingElement;
    return scrolling
      ? scrolling.scrollHeight - (scrolling.scrollTop + element.getBoundingClientRect().bottom)
      : 0;
  });
  expect(distanceFromPageEnd).toBeLessThan(48);

  const subNav = page.getByRole("navigation", { name: "Trip" });
  for (const tab of ["Overview", "Guests", "Manifest", "Prep"]) {
    await expect(subNav.getByText(tab, { exact: true })).toBeVisible();
  }

  // Each tab is one tap away and lands on its surface.
  await subNav.getByRole("link", { name: "Guests" }).click();
  await expect(page).toHaveURL(/\/guests/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
  await expect(boatMode).toHaveCount(0);

  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Prep" }).click();
  await expect(page).toHaveURL(/\/prep/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
  await expect(boatMode).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await expect(page).toHaveURL(/\/manifest/);
  await expect(boatMode).toBeVisible();

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
  await expect(boatMode).toHaveCount(0);
});

test("staff can view or copy a trip's public booking page from its overview", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-write", "clipboard-read"]);
  await page.goto("/shop/blue-mantis");
  await page.getByRole("link", { name: "Board divers" }).first().click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Overview" })
    .click();

  // The booking page stays on screen for a staffer now — it used to redirect
  // straight back to the management view, which made this button impossible to
  // use — and says whose view they are looking at instead.
  const [publicPage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "View booking page" }).click(),
  ]);
  await publicPage.waitForLoadState("domcontentloaded");
  await expect(publicPage).toHaveURL(/\/s\/blue-mantis\/trips\/[a-f0-9-]+$/);
  await expect(
    publicPage.getByText("You’re looking at the diver’s view of this departure."),
  ).toBeVisible();
  await publicPage.getByRole("link", { name: "Manage this trip" }).click();
  await expect(publicPage).toHaveURL(/\/shop\/blue-mantis\/trips\/[a-f0-9-]+$/);
  await publicPage.close();

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toMatch(/\/s\/blue-mantis\/trips\/[a-f0-9-]+$/);
});
