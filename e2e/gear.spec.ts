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

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("staff can retire gear only after it is in the gear room", async ({ page }) => {
  const label = `REG-RETIRED-${Date.now()}`;
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/gear");
  // The add-gear form lives inside a collapsed <details>; open it first.
  await page.locator("#add-gear > summary").click();
  await page.getByPlaceholder("BCD-12").fill(label);
  await page.locator('#add-gear select[name="type"]').selectOption("regulator");
  await page.locator('#add-gear button[type="submit"]').click();
  await expect(page.getByRole("status")).toContainText("Gear added");

  const row = page.locator("li").filter({ hasText: label }).first();
  await row.getByText("Retire", { exact: true }).click(); // open the retire confirmation popover
  await row.getByRole("button", { name: "Retire item" }).click();
  await expect(page.getByRole("status")).toContainText("Gear retired");
  await expect(row.getByText("retired", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Retire item" })).toHaveCount(0);
});

test("staff can bulk-pack a diver's exact-size rental request", async ({ page }) => {
  const suffix = Date.now();
  const title = `Bulk pack ${suffix}`;
  const label = `BCD-M-BULK-${suffix}`;
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/gear");
  // The add-gear form lives inside a collapsed <details>; open it first.
  await page.locator("#add-gear > summary").click();
  await page.getByPlaceholder("BCD-12").fill(label);
  await page.locator('#add-gear select[name="type"]').selectOption("bcd");
  await page.locator('#add-gear input[name="size"]').fill("M");
  await page.locator('#add-gear button[type="submit"]').click();

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:30");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).getByRole("link").click();
  await page.getByLabel("Name").fill("Mira Diver");
  await page.getByLabel("Email").fill(`mira-${suffix}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await page.getByLabel("BCD size").selectOption("M");
  await page.getByRole("button", { name: "Save gear request" }).click();

  await signInAsOwner(page);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Pack recommendations" }).click();
  await expect(page.getByRole("status")).toContainText("Available gear was packed");
  await expect(page.getByText(label)).toBeVisible();
});
