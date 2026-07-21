import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

test("the trip sub-nav reaches all four boat surfaces in one tap", async ({ page }) => {
  await signInAsOwner(page);

  // Today's departure card drops staff straight onto check-in.
  await page.getByRole("link", { name: "Check in" }).first().click();
  await expect(page).toHaveURL(/\/check-in/);

  const subNav = page.getByRole("navigation", { name: "Trip" });
  for (const tab of ["Overview", "Check-in", "Manifest", "Prep"]) {
    await expect(subNav.getByText(tab, { exact: true })).toBeVisible();
  }

  // Each tab is one tap away and lands on its surface.
  await subNav.getByRole("link", { name: "Manifest" }).click();
  await expect(page).toHaveURL(/\/manifest/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();

  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Prep" }).click();
  await expect(page).toHaveURL(/\/prep/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
});

test("the nav offers a Boat view shortcut to today's departure", async ({ page }) => {
  await signInAsOwner(page);
  // The seed sails a boat today, so the nav badge is a live link to its check-in.
  await page.getByRole("link", { name: "Boat view" }).click();
  await expect(page).toHaveURL(/\/check-in/);
});
