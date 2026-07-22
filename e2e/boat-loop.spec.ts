import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the trip sub-nav reaches all four surfaces, and the nav's Boat view shortcut lands on the manifest", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis");

  // Today's departure card drops staff straight onto the manifest's boarding pass.
  await page.getByRole("link", { name: "Boarding" }).first().click();
  await expect(page).toHaveURL(/\/manifest/);

  const subNav = page.getByRole("navigation", { name: "Trip" });
  for (const tab of ["Overview", "Guests", "Manifest", "Prep"]) {
    await expect(subNav.getByText(tab, { exact: true })).toBeVisible();
  }

  // Each tab is one tap away and lands on its surface.
  await subNav.getByRole("link", { name: "Guests" }).click();
  await expect(page).toHaveURL(/\/guests/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();

  await page.getByRole("navigation", { name: "Trip" }).getByRole("link", { name: "Prep" }).click();
  await expect(page).toHaveURL(/\/prep/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await expect(page).toHaveURL(/\/manifest/);

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();

  // The seed sails a boat today, so the nav badge is a live link to its manifest.
  await page.goto("/shop/blue-mantis");
  await page.getByRole("link", { name: "Boat view" }).click();
  await expect(page).toHaveURL(/\/manifest/);
});
