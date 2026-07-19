import { expect, test } from "./fixtures";

test("landing demo CTA drops a visitor into the staff shop with a demo banner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo Playground")).toBeVisible();
});

test("sign-in keeps the demo entry on the homepage", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Explore the demo shop" })).toHaveCount(0);
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
