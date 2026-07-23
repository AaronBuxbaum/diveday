import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the diver roster offers role-view chips that drive the filter", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  await expect(page.getByRole("heading", { level: 1, name: "Divers" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Saved views" });
  await views.getByRole("link", { name: "Missing contact" }).click();
  await expect(page).toHaveURL(/filter=missing_contact/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await views.getByRole("link", { name: "Has insurance" }).click();
  await expect(page).toHaveURL(/filter=insured/);

  await views.getByRole("link", { name: "All divers" }).click();
  await expect(page).toHaveURL(/\/divers$/);
});
