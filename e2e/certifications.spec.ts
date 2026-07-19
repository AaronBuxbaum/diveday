import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

/** The diver detail page has two capture forms; scope by the form's own submit button. */
function levelForm(page: Page) {
  return page.locator("form", {
    has: page.getByRole("button", { name: "Capture for review", exact: true }),
  });
}
function specialtyForm(page: Page) {
  return page.locator("form", {
    has: page.getByRole("button", { name: "Capture specialty for review" }),
  });
}

test("staff captures and verifies a certification before it can be trusted", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();
  const form = levelForm(page);
  await expect(form.locator('input[name="cardImageUrl"]')).toHaveCount(0);
  await expect(form.locator('input[name="cardImage"]')).toBeVisible();
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Card number").fill(`PADI-AOW-${Date.now()}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  const pendingRow = page.locator("li").filter({ hasText: "pending" }).last();
  await pendingRow.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
});

test("staff captures and verifies a specialty card, gated the same way", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();
  const form = specialtyForm(page);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="specialty"]').selectOption("wreck");
  await form.getByLabel("Card number").fill(`PADI-WRECK-${Date.now()}`);
  await form.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  const pendingRow = page
    .locator("li")
    .filter({ hasText: "specialty" })
    .filter({ hasText: "pending" })
    .last();
  await pendingRow.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
});
