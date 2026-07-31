import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { signInAs } from "./helpers";

/**
 * H-14 (ADR 20260724-role-authorization) draws real boundaries on five staff
 * surfaces. This lens signs in as three roles and checks each sees only what
 * its role admits: the daily crew (captain) is denied money, the legal waiver,
 * diver deletion, and trip configuration; an instructor may configure trips but
 * not money or legal; the owner reaches everything. The server actions re-check
 * regardless — these assertions cover the UI-hiding courtesy the ADR also asks
 * for. Each test signs in fresh rather than reusing the per-worker owner session.
 */
const SHOP = DEMO_SHOP_SLUG;

async function firstDiverDetailHref(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/shop/${SHOP}/divers`);
  const href = await page.locator(`a[href^="/shop/${SHOP}/divers/"]`).first().getAttribute("href");
  if (!href) throw new Error("no diver detail link found");
  return href;
}

async function firstTripManageHref(page: import("@playwright/test").Page): Promise<string> {
  // Signed-in staff see the schedule's cards link straight to trip management.
  // Exclude the "Schedule a trip" CTA (/trips/new) — we want a real trip's id.
  await page.goto(`/shop/${SHOP}/schedule`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/trips/"]:not([href="/shop/${SHOP}/trips/new"])`)
    .first()
    .getAttribute("href");
  if (!href) throw new Error("no trip management link found");
  return href;
}

test.describe("H-14 role permissions", () => {
  test("the daily crew (captain) is denied money, legal, deletion, and trip config", async ({
    page,
  }) => {
    await signInAs(page, DEV_STAFF_LOGINS.captain);

    // Waiver — the legal instrument — has no use for the daily crew, so the
    // surface doesn't exist for them: bounced to Today, not shown read-only.
    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page).toHaveURL(`/shop/${SHOP}`);
    await expect(page.locator('textarea[name="body"]')).toHaveCount(0);

    // Its Signatures tab (task 155) — read access to signed medical/waiver
    // records — takes the exact same gate, never a looser one just because
    // it's a sub-route.
    await page.goto(`/shop/${SHOP}/waivers/signatures`);
    await expect(page).toHaveURL(`/shop/${SHOP}`);
    await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toHaveCount(0);

    // Payment settings — Stripe + rental catalog/prices — are hidden.
    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByText("payment settings, limited to owners and managers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save rental catalog" })).toHaveCount(0);

    // Trip creation is hidden.
    await page.goto(`/shop/${SHOP}/trips/new`);
    await expect(page.getByText("limited to owners, managers, and instructors")).toBeVisible();
    await expect(page.getByRole("button", { name: "Put it on the board" })).toHaveCount(0);

    // Diver deletion is hidden.
    await page.goto(await firstDiverDetailHref(page));
    await expect(page.getByRole("heading", { name: "Remove from active divers" })).toHaveCount(0);

    // On a trip's Overview, trip *definition* is hidden, but the day-of operating
    // actions the glossary assigns to crew — conditions, crew, weather cancel —
    // stay available.
    await page.goto(await firstTripManageHref(page));
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Publish crew prediction" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save crew" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel trip" })).toBeVisible();
  });

  test("an instructor may configure trips but not money or legal", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.instructor);

    // Trip configuration is instructor work — the form is present.
    await page.goto(`/shop/${SHOP}/trips/new`);
    await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

    // Money and the legal waiver are still owner/manager only — including
    // its Signatures tab.
    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page).toHaveURL(`/shop/${SHOP}`);
    await expect(page.locator('textarea[name="body"]')).toHaveCount(0);

    await page.goto(`/shop/${SHOP}/waivers/signatures`);
    await expect(page).toHaveURL(`/shop/${SHOP}`);
    await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toHaveCount(0);

    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByText("payment settings, limited to owners and managers")).toBeVisible();
  });

  test("the owner reaches every gated surface", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.owner);

    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page.locator('textarea[name="body"]')).toBeVisible();

    await page.goto(`/shop/${SHOP}/waivers/signatures`);
    await expect(page.getByRole("heading", { level: 1, name: "Signatures" })).toBeVisible();

    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("button", { name: "Save rental catalog" })).toBeVisible();

    await page.goto(`/shop/${SHOP}/trips/new`);
    await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

    await page.goto(await firstDiverDetailHref(page));
    await expect(page.getByRole("heading", { name: "Remove from active divers" })).toBeVisible();

    // Trip definition is available to the owner.
    await page.goto(await firstTripManageHref(page));
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  });
});
