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

test.describe("H-14 role permissions", () => {
  test("the daily crew (captain) is denied money, legal, deletion, and trip config", async ({
    page,
  }) => {
    await signInAs(page, DEV_STAFF_LOGINS.captain);

    // Waiver — the legal instrument — is read-only.
    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page.getByText("limited to owners and managers")).toBeVisible();
    await expect(page.locator('textarea[name="body"]')).toHaveCount(0);

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
  });

  test("an instructor may configure trips but not money or legal", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.instructor);

    // Trip configuration is instructor work — the form is present.
    await page.goto(`/shop/${SHOP}/trips/new`);
    await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

    // Money and the legal waiver are still owner/manager only.
    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page.getByText("limited to owners and managers")).toBeVisible();
    await expect(page.locator('textarea[name="body"]')).toHaveCount(0);

    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByText("payment settings, limited to owners and managers")).toBeVisible();
  });

  test("the owner reaches every gated surface", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.owner);

    await page.goto(`/shop/${SHOP}/waivers`);
    await expect(page.locator('textarea[name="body"]')).toBeVisible();

    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("button", { name: "Save rental catalog" })).toBeVisible();

    await page.goto(`/shop/${SHOP}/trips/new`);
    await expect(page.getByRole("button", { name: "Put it on the board" })).toBeVisible();

    await page.goto(await firstDiverDetailHref(page));
    await expect(page.getByRole("heading", { name: "Remove from active divers" })).toBeVisible();
  });
});
