import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

test("staff can retire gear only after it is in the gear room", async ({ page }) => {
  const label = `REG-RETIRED-${Date.now()}`;
  await signInAsOwner(page);
  await page.goto("/shop/gear");
  await page.getByPlaceholder("BCD-12").fill(label);
  await page.locator('select[name="type"]').selectOption("regulator");
  await page.getByRole("button", { name: "Add inventory item" }).click();
  await expect(page.getByRole("status")).toContainText("Gear added");

  const row = page.locator("li").filter({ hasText: label }).first();
  await row.getByRole("button", { name: "Retire item" }).click();
  await expect(page.getByRole("status")).toContainText("Gear retired");
  await expect(row.getByText("retired", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Retire item" })).toHaveCount(0);
});
