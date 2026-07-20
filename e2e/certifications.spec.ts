import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

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
  await page.getByText("Add card", { exact: true }).click(); // open the collapsed capture form
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
  await page.getByText("Add specialty", { exact: true }).click(); // open the collapsed capture form
  const cardNo = `PADI-WRECK-${Date.now()}`;
  const form = specialtyForm(page);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="specialty"]').selectOption("wreck");
  await form.getByLabel("Card number").fill(cardNo);
  await form.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const pendingRow = page.locator("li").filter({ hasText: cardNo }).last();
  await pendingRow.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
});
