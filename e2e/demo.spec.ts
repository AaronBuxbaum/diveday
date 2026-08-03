import { expect, test } from "./fixtures";

test("landing demo CTA drops a visitor into the staff shop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the staff app" }).first().click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
  ).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo shop")).toBeVisible();

  // A minted demo shows the visitor how to sign back in if their session
  // expires — the shop is throwaway, so plain-text credentials are fine.
  await expect(page.getByText(/Session expired\? Sign back in at/)).toBeVisible();
  await expect(page.getByText("password")).toBeVisible();
});

test("demo role switcher moves from owner to instructor and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the staff app" }).first().click();
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

test("the homepage's role picker previews before committing to a role", async ({ page }) => {
  await page.goto("/");

  // Under the primary CTA, not replacing it — the picker is a second door,
  // not a rename of "Try the staff app" (UX persona review #103). The same
  // label also appears on the page's closing-band CTA (deliberately
  // consistent with the hero, conversion-reviewer finding) — `.first()`
  // targets the hero.
  await expect(page.getByRole("button", { name: "Try the staff app" }).first()).toBeVisible();
  const captainOption = page.getByRole("button", { name: "Try the demo as Captain" });
  await expect(captainOption).toBeVisible();

  // Hovering surfaces that role's "Try:" prompt (demo.roles.captain.tryThis)
  // before any click commits to it.
  await captainOption.hover();
  await expect(page.getByText(/run the passenger roll call/i)).toBeVisible();

  await captainOption.click();
  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByText(/Viewing as/)).toContainText("Captain");
});

test("picking the diver role from the homepage skips straight to the public schedule", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo as Diver" }).click();

  await expect(page).toHaveURL(/\/s\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  // The diver-facing schedule, not a staff console — no sign-in chrome, no
  // session minted for a role that was only ever a preview.
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("an onboarded trial shop is a real shop, not demo mode", async ({ page }) => {
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Coral Cove Divers");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill("coral-cove-e2e");
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Riva Okonkwo");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill("riva-e2e@coralcove.example");
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  // A real shop is never seeded — there's no sample-data option to toggle. It
  // starts clean and must not be a demo playground (ADR 20260724).
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  await expect(page).toHaveURL(/\/shop\/coral-cove-e2e/);
  // A trial is a real shop: no Demo shop banner, no destructive reset.
  await expect(page.getByText("Demo shop")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
});
