import { expect, test } from "./fixtures";

test("landing demo CTA drops a visitor into the staff shop with a demo banner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { name: "Good to see you, Dana" })).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo Playground")).toBeVisible();
});

test("sign-in keeps the demo entry on the homepage", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Explore the demo shop" })).toHaveCount(0);
});

test("demo role switcher moves from owner to instructor and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();
  await expect(page.getByText("Demo Playground")).toBeVisible();
  await expect(page.getByText(/Viewing as/)).toContainText("Admin / Owner");

  // Switch to the instructor seeded in this shop, then back to the owner.
  await page.getByRole("button", { name: /^Switch Role/ }).click();
  await page.getByRole("button", { name: "Switch to Instructor" }).click();
  await expect(page.getByText(/Viewing as/)).toContainText("Instructor");

  await page.getByRole("button", { name: /^Switch Role/ }).click();
  await page.getByRole("button", { name: "Switch to Admin / Owner" }).click();
  await expect(page.getByText(/Viewing as/)).toContainText("Admin / Owner");
});

test("an onboarded trial shop is a real shop, not demo mode", async ({ page }) => {
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').fill("Coral Cove Divers");
  await page.locator('input[name="shopSlug"]').fill("coral-cove-e2e");
  await page.locator('input[name="ownerName"]').fill("Riva Okonkwo");
  await page.locator('input[name="ownerEmail"]').fill("riva-e2e@coralcove.example");
  await page.locator('input[name="ownerPassword"]').fill("trial-pass-123");
  // Leave "Seed with demo data" unchecked: seeding is a convenience, and it must
  // not turn the trial into a demo playground either way.
  await page.locator('input[name="seedDemoData"]').uncheck();
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  await expect(page).toHaveURL(/\/shop\/coral-cove-e2e/);
  // A trial is a real shop: no Demo Playground banner, no destructive reset.
  await expect(page.getByText("Demo Playground")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
});

test("reset restores the demo schedule and confirms with a notice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();
  await expect(page).toHaveURL(/\/shop/);

  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Demo data reset" })).toBeVisible();
  // Still signed in after the reset — the session survives it.
  await expect(page.getByRole("heading", { name: "Good to see you, Dana" })).toBeVisible();
});
