import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";

const SHOP = DEMO_SHOP_SLUG;

/**
 * ADR 20260731-shop-currency: `shops.currency` is the one source of truth for
 * what a shop displays and charges, and nothing in the app is allowed to
 * assume dollars.
 *
 * The seeded shop stays USD (so every other spec and the visual baselines see
 * the currency they always have); these tests switch it, assert, and switch
 * back within their own case.
 */

/** Pick a currency in settings and wait for the save to land. */
async function setCurrency(page: import("@playwright/test").Page, code: string) {
  await page.goto(`/shop/${SHOP}/settings`);
  await page.getByLabel(/Charge and display in/).selectOption(code);
  await page.getByRole("button", { name: "Save currency" }).click();
  await expect(page.getByText(/Currency saved/)).toBeVisible();
}

test.describe("shop currency", () => {
  signedInAsOwner();

  test("switching the currency re-denominates every staff price surface", async ({ page }) => {
    await setCurrency(page, "eur");
    try {
      // The schedule's trip prices are the highest-traffic money surface.
      await page.goto(`/shop/${SHOP}/schedule`);
      await expect(page.getByText(/€/).first()).toBeVisible();
      await expect(page.getByText(/\$\d/)).toHaveCount(0);

      // The rental price boxes prefix with the shop's symbol, not a literal $.
      await page.goto(`/shop/${SHOP}/settings`);
      await expect(page.getByText("€", { exact: true }).first()).toBeVisible();
    } finally {
      await setCurrency(page, "usd");
    }
  });

  /**
   * The regression this whole change exists to prevent. JPY has no minor unit,
   * so a stored 13000 is ¥13,000 — a literal `/ 100` renders it as ¥130 and
   * undercharges by two orders of magnitude. Asserting the *absence* of a
   * decimal point is the cheap, precise way to catch it.
   */
  test("a zero-decimal currency is never divided by 100", async ({ page }) => {
    await setCurrency(page, "jpy");
    try {
      await page.goto(`/shop/${SHOP}/schedule`);
      const yen = page.getByText(/¥[\d,]+/).first();
      await expect(yen).toBeVisible();
      expect(await yen.textContent()).not.toMatch(/¥[\d,]*\.\d/);

      // Whole-number entry: a ¥1,234.56 price does not exist, so the price box
      // must not invite one.
      await page.goto(`/shop/${SHOP}/settings`);
      const priceBox = page.getByLabel(/Full set/).first();
      await expect(priceBox).toHaveAttribute("step", "1");
    } finally {
      await setCurrency(page, "usd");
    }
  });

  /**
   * A price typed under one currency keeps its *number*, not its value — the
   * settings copy promises exactly this, and a shop that read "converted"
   * would mis-price its whole catalog. Worth an assertion because it's the
   * surprising half of the behaviour.
   */
  test("switching currency re-denominates a price rather than converting it", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/settings`);
    const fullSet = page.getByLabel(/Full set/).first();
    await fullSet.fill("40");
    await page.getByRole("button", { name: /Save rental prices/ }).click();
    await expect(page.getByText(/Rental prices saved/)).toBeVisible();

    await setCurrency(page, "eur");
    try {
      await page.goto(`/shop/${SHOP}/settings`);
      await expect(page.getByLabel(/Full set/).first()).toHaveValue("40");
    } finally {
      await setCurrency(page, "usd");
    }
  });
});
