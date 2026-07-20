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

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await signInAsOwner(page);
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
