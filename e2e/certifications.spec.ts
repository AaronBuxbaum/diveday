import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

test("staff captures and verifies a certification before it can be trusted", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/certifications");
  await page.locator('select[name="personId"]').selectOption({ index: 1 }); // Priya in deterministic seed
  await page.locator('select[name="agency"]').selectOption("padi");
  await page.locator('select[name="level"]').selectOption("advanced_open_water");
  await page.getByLabel("Card number").fill(`PADI-AOW-${Date.now()}`);
  await page.getByRole("button", { name: "Capture for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  const pendingRow = page.locator("li").filter({ hasText: "pending" }).last();
  await pendingRow.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
});
