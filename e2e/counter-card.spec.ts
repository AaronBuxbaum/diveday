import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

/**
 * **The counter card** (issue #1236): Settings shows the shop's register QR,
 * and its Print button opens the same code as an A6 sheet a shop stands on
 * its desk.
 */
test("the counter card in Settings opens its own printable sheet", async ({ page }) => {
  await page.goto("/shop/blue-mantis/settings");
  const row = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "The counter card", exact: true }) })
    .first();
  await row.locator("> summary").click();
  const print = row.getByRole("link", { name: "Print", exact: true });
  await expect(print).toHaveAttribute("href", "/shop/blue-mantis/print/counter-card");

  await page.goto("/shop/blue-mantis/print/counter-card");
  await expect(page.getByRole("heading", { name: "New here? Scan this." })).toBeVisible();
  await expect(page.locator(".paper-sheet").getByRole("img")).toHaveCount(1);
  await expect(page.getByText(/\/s\/blue-mantis\//).first()).toBeVisible();
});
