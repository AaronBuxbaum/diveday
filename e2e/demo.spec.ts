import { expect, test } from "./fixtures";
import { STAFF_DAY_HEADING } from "./helpers";
import { mintOnboardFormPath } from "./setup-link";

test("landing demo CTA drops a visitor into the staff shop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
  // The demo banner rides above every /shop surface.
  await expect(page.getByText("Demo shop")).toBeVisible();

  // **No credential pair anywhere in the chrome** (issue #806; visual review
  // 2026-10-24, A41). The fallback sign-in lives in the demo docs, not in a
  // banner a prospective buyer reads inside the product. The warning that
  // earns its place stays.
  await expect(page.getByText(/Do not enter real customer details/)).toBeVisible();
  await expect(page.getByText(/Session expired/)).toHaveCount(0);

  // The picker is a popover of one row per role, the one in force reading
  // "Current"; Escape closes it and hands focus back to its button.
  const trigger = page.getByRole("button", { name: /^Switch role/ });
  await trigger.click();
  const picker = page.locator("#demo-role-picker");
  await expect(picker.getByText("Current", { exact: true })).toBeVisible();
  await expect(picker.getByText(/Session expired|password/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("demo role switcher moves from owner to instructor and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).first().click();
  await expect(page.getByText("Demo shop")).toBeVisible();
  await expect(page.locator("p", { hasText: /Viewing as/ })).toContainText("Owner");

  // Switch to the instructor seeded in this shop, then back to the owner.
  await page.getByRole("button", { name: /^Switch role/ }).click();
  await page.getByRole("button", { name: "Switch to Instructor" }).click();
  await expect(page.locator("p", { hasText: /Viewing as/ })).toContainText("Instructor");

  await page.getByRole("button", { name: /^Switch role/ }).click();
  await page.getByRole("button", { name: "Switch to Owner" }).click();
  await expect(page.locator("p", { hasText: /Viewing as/ })).toContainText("Owner");
});

// The homepage's pre-entry role picker is deliberately gone: it put five more
// controls in the hero (nine total — decision overload for a first-time
// buyer), duplicating the in-app role switcher one click away. Role-by-role
// exploration is covered by the switcher test above; the diver preview is the
// online booking page's own demo door, which opens the demo as a diver on the
// shop's public schedule (see marketing.spec.ts).

test("an onboarded trial shop is a real shop, not demo mode", async ({ page }) => {
  // Unique per run: a trial shop is a real shop, so nothing ever clears it —
  // not the per-test reset, not `purgeMintedDemoShops` — and a fixed slug
  // collides with itself the moment the same database sees this spec twice.
  // `Date.now()` is the runner's real clock; `e2eNow()` is the fleet's frozen
  // instant and would produce the same string every run.
  const slug = `coral-cove-e2e-${Date.now()}-${process.pid}`;
  await page.goto(await mintOnboardFormPath(page));
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
