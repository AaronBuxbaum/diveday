import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

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

test("staff captures and verifies level and specialty cards before either can be trusted", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();

  // Level card: capture lands as pending, only an explicit verify trusts it.
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

  // Specialty card: gated exactly the same way, on the same record.
  await page.getByText("Add specialty", { exact: true }).click(); // open the collapsed capture form
  const cardNo = `PADI-WRECK-${Date.now()}`;
  const specialty = specialtyForm(page);
  await specialty.locator('select[name="agency"]').selectOption("padi");
  await specialty.locator('select[name="specialty"]').selectOption("wreck");
  await specialty.getByLabel("Card number").fill(cardNo);
  await specialty.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const specialtyRow = page.locator("li").filter({ hasText: cardNo }).last();
  await specialtyRow.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
});
