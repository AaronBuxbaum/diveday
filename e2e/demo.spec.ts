import { expect, test } from "./fixtures";

test("landing demo CTA drops a visitor into the staff shop, and reset restores the playground", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { name: "Good to see you, Dana" })).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo shop")).toBeVisible();

  // Reset confirms with a notice and the session survives it.
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Demo data reset" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Good to see you, Dana" })).toBeVisible();
});

test("demo role switcher moves from owner to instructor and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();
  await expect(page.getByText("Demo shop")).toBeVisible();
  await expect(page.getByText(/Viewing as/)).toContainText("Admin / Owner");

  // Switch to the instructor seeded in this shop, then back to the owner.
  await page.getByRole("button", { name: /^Switch role/ }).click();
  await page.getByRole("button", { name: "Switch to Instructor" }).click();
  await expect(page.getByText(/Viewing as/)).toContainText("Instructor");

  await page.getByRole("button", { name: /^Switch role/ }).click();
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
  // Leave "Start with sample trips" unchecked: seeding is a convenience, and it must
  // not turn the trial into a demo playground either way.
  await page.locator('input[name="seedDemoData"]').uncheck();
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  await expect(page).toHaveURL(/\/shop\/coral-cove-e2e/);
  // A trial is a real shop: no Demo shop banner, no destructive reset.
  await expect(page.getByText("Demo shop")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
});
