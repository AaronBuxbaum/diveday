import { expect, test } from "@playwright/test";

test("landing demo CTA drops a visitor into the staff shop with a demo banner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo shop.")).toBeVisible();
});

test("sign-in offers the demo without a password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Explore the demo shop" }).click();
  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByText("Demo shop.")).toBeVisible();
});

test("reset restores the demo schedule and confirms with a notice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page).toHaveURL(/\/shop/);

  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Demo data reset" })).toBeVisible();
  // Still signed in after the reset — the session survives it.
  await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
});
