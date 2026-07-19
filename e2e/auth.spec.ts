import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

test("unauthenticated /shop redirects to sign-in", async ({ page }) => {
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong password shows a friendly error and stays signed out", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Filtered because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("staff sign-in lands on the shop dashboard and sign-out locks it again", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
  await expect(page.getByText("of 12 booked").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});
