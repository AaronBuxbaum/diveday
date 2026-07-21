import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");

  // The whole person cell is one link, so the initials avatar opens the diver
  // just like the name does.
  const row = page.getByRole("row").filter({ hasText: "Priya Sharma" });
  await row.getByText("PS", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").last();
  await expect(header.locator('a[href^="mailto:"]')).toBeVisible();
  await expect(header.locator('a[href^="tel:"]')).toBeVisible();
});
