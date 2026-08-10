import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

/**
 * ADR 20260731-shop-currency: `shops.currency` is the one source of truth for
 * what a shop displays and charges, and nothing in the app is allowed to
 * assume dollars.
 *
 * The seeded shop stays USD so every other spec and the visual baselines see
 * the currency they always have. `resetDemoSchedule` (the per-test fixture)
 * clears trips and bookings but **not** the `shops` row, so each test here
 * restores the currency in a `finally` — otherwise the change leaks into every
 * later test on the same worker.
 *
 * Assertions land on the reports revenue figure and the settings price boxes
 * rather than the schedule. The schedule renders prices only on its public
 * branch, and the demo shop signs every visitor in as the demo owner, so even
 * a cookie-less context gets the staff board — which shows no price at all.
 */

/**
 * Pick a currency in settings and wait for the save to land. Leaves the page
 * on the settings route, so a caller asserting there needs no further
 * navigation.
 */
async function setCurrency(page: Page, code: string) {
  await page.goto(`/shop/${SHOP}/settings`);
  await openSettingsRow(page, "Units");
  await page.getByLabel("Charge and display in", { exact: true }).selectOption(code);
  // Currency shares the "Units" card and its one save button with the depth and
  // water-temperature units — the two selects beside it post their rendered
  // values unchanged.
  await page.getByRole("button", { name: "Save units" }).click();
  await expect(page.getByText(/Units saved/)).toBeVisible();
}

/** The digits of the reports revenue headline, with symbol and separators stripped. */
async function reportedRevenueDigits(page: Page, symbol: string): Promise<number> {
  await page.goto(`/shop/${SHOP}/reports`);
  const figure = page.getByText(new RegExp(`${symbol}[\\d,]+`)).first();
  await expect(figure).toBeVisible();
  const text = (await figure.textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("shop currency", () => {
  // Every test here drives the currency through settings and reads it back on
  // reports, so one test is up to five full page loads plus three server-action
  // writes, each with its own status-toast wait. Measured idle at one worker:
  // 7.8s, 9.2s, 5.9s — the middle one already spends 61% of the default 15s
  // budget with no contention at all, leaving under six seconds of headroom for
  // a shared two-worker CI runner. A traced CI failure showed exactly that:
  // every step resolving, the "Units saved" toast simply not reached in
  // time. Same aggregate-cost reasoning as add-diver.spec.ts and
  // visual.spec.ts — this override cannot mask a hang, because a hang fails the
  // 8s expect timeout inside it either way.
  test.setTimeout(30_000);

  signedInAsOwner();

  test("money follows the shop's currency instead of assuming dollars", async ({ page }) => {
    await setCurrency(page, "eur");
    try {
      // Staff price entry first — we're already on settings; the price boxes
      // wait behind the "Rental prices" row. The box is prefixed with the
      // shop's own symbol, not a literal `$`.
      await openSettingsRow(page, "Rental prices");
      await expect(page.getByText("€", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("$", { exact: true })).toHaveCount(0);

      await page.goto(`/shop/${SHOP}/reports`);
      await expect(page.getByText(/€[\d,]+/).first()).toBeVisible();
      await expect(page.getByText(/\$\d/)).toHaveCount(0);
    } finally {
      await setCurrency(page, "usd");
    }
  });

  /**
   * The regression this whole change exists to prevent. JPY has no minor unit,
   * so a stored 13000 is ¥13,000 while the same 13000 is €130.00 — a literal
   * `/ 100` renders the yen figure as ¥130 and understates it by two orders of
   * magnitude.
   *
   * Comparing the two renderings of the *same stored revenue* is the honest
   * assertion: the yen number must be exactly 100x the euro one, and that
   * holds no matter what the seed's amounts are.
   */
  test("a zero-decimal currency is never divided by 100", async ({ page }) => {
    await setCurrency(page, "eur");
    try {
      const euros = await reportedRevenueDigits(page, "€");
      expect(euros).toBeGreaterThan(0);

      await setCurrency(page, "jpy");
      // Whole-number entry: a ¥1,234.56 price does not exist, so the price box
      // must not invite one. setCurrency left us on settings; the box waits
      // behind the "Rental prices" row.
      await openSettingsRow(page, "Rental prices");
      await expect(page.getByLabel(/Full set/).first()).toHaveAttribute("step", "1");

      expect(await reportedRevenueDigits(page, "¥")).toBe(euros * 100);
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
    // Reads the seeded price rather than writing one. `resetDemoSchedule`
    // clears trips and bookings but not the `shops` row, so a rental price
    // typed here would outlive the test and change what `rentals.spec.ts`
    // sees on the booking confirmation — which is exactly what it did.
    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "Rental prices");
    const seeded = await page
      .getByLabel(/Full set/)
      .first()
      .inputValue();
    expect(seeded).not.toBe("");

    await setCurrency(page, "eur");
    try {
      await openSettingsRow(page, "Rental prices");
      await expect(page.getByLabel(/Full set/).first()).toHaveValue(seeded);
    } finally {
      await setCurrency(page, "usd");
    }
  });
});
