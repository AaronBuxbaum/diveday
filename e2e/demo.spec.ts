import { expect, test } from "./fixtures";

test("landing demo CTA drops a visitor into the staff shop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
  ).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo shop")).toBeVisible();

  // A minted demo shows the visitor how to sign back in if their session
  // expires — the shop is throwaway, so plain-text credentials are fine.
  await expect(page.getByText(/Session expired\? Sign back in at/)).toBeVisible();
  await expect(page.getByText("demo-role-switcher-bypass-token")).toBeVisible();

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
  // A real shop is never seeded — there's no sample-data option to toggle. It
  // starts clean and must not be a demo playground (ADR 20260724).
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  await expect(page).toHaveURL(/\/shop\/coral-cove-e2e/);
  // A trial is a real shop: no Demo shop banner, no destructive reset.
  await expect(page.getByText("Demo shop")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
});
