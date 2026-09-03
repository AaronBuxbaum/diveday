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

  // **The first frame is not a credential pair.** This used to print a
  // plaintext email and password on every page of the demo from the first
  // millisecond, so the first sentence a prospective buyer read inside the
  // product was recovery instructions for a failure that had not happened
  // (issue #806). The warning that earns its place stays.
  await expect(page.getByText(/Do not enter real customer details/)).toBeVisible();
  await expect(page.getByText(/Session expired\? Sign back in at/)).toBeHidden();

  // It is one tap away, behind the control the banner already had — a minted
  // demo is throwaway data, so the way back in is a courtesy rather than a
  // secret; it just is not the greeting.
  await page.getByRole("button", { name: /^Switch role/ }).click();
  await expect(page.getByText(/Session expired\? Sign back in at/)).toBeVisible();
  await expect(page.getByText("password").first()).toBeVisible();
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

// The homepage's pre-entry role picker is deliberately gone: it put five more
// controls in the hero (nine total — decision overload for a first-time
// buyer), duplicating the in-app role switcher one click away. Role-by-role
// exploration is covered by the switcher test above; the diver preview lives
// on the diver's row of the homepage's daily-moments section (see marketing.spec.ts).

test("an onboarded trial shop is a real shop, not demo mode", async ({ page }) => {
  // Unique per run: a trial shop is a real shop, so nothing ever clears it —
  // not the per-test reset, not `purgeMintedDemoShops` — and a fixed slug
  // collides with itself the moment the same database sees this spec twice.
  // `Date.now()` is the runner's real clock; `e2eNow()` is the fleet's frozen
  // instant and would produce the same string every run.
  const slug = `coral-cove-e2e-${Date.now()}-${process.pid}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Coral Cove Divers");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(slug);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Riva Okonkwo");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`riva-${slug}@coralcove.example`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  // A real shop is never seeded — there's no sample-data option to toggle. It
  // starts clean and must not be a demo playground (ADR 20260724).
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  await expect(page).toHaveURL(new RegExp(`/shop/${slug}`));
  // A trial is a real shop: no Demo shop banner, no destructive reset.
  await expect(page.getByText("Demo shop")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
});
