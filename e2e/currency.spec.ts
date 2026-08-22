import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

/**
 * ADR 20260731-shop-currency: `shops.currency` is the one source of truth for
 * what a shop displays and charges, and nothing in the app is allowed to
 * assume dollars.
 *
 * Every test here takes a shop of its own (`privateShop`, ADR
 * 20260815-per-test-private-shops) and drives *its* currency, rather than
 * driving blue-mantis's and putting it back in a `finally`. `shops.currency` is
 * not one of the three columns the per-test reset restores, so the old shape
 * was one thrown error away from leaving the whole worker's shop — and its
 * visual baselines — charging in yen.
 *
 * Assertions land on the reports revenue figure and the settings price boxes
 * rather than the schedule. The schedule renders prices only on its public
 * branch, and a demo shop signs every visitor in as the demo owner, so even
 * a cookie-less context gets the staff board — which shows no price at all.
 */

/**
 * Pick a currency in settings and wait for the save to land. Leaves the page
 * on the settings route, so a caller asserting there needs no further
 * navigation.
 */
async function setCurrency(page: Page, shopSlug: string, code: string) {
  await page.goto(`/shop/${shopSlug}/settings`);
  await openSettingsRow(page, "Units");
  await page.getByLabel("Charge and display in", { exact: true }).selectOption(code);
  // Currency shares the "Units" card and its one save button with the depth and
  // water-temperature units — the two selects beside it post their rendered
  // values unchanged.
  await page.getByRole("button", { name: "Save units" }).click();
  await expect(page.getByText(/Units saved/)).toBeVisible();
}

/** The digits of the reports revenue headline, with symbol and separators stripped. */
async function reportedRevenueDigits(
  page: Page,
  shopSlug: string,
  symbol: string,
): Promise<number> {
  await page.goto(`/shop/${shopSlug}/reports`);
  const figure = page.getByText(new RegExp(`${symbol}[\\d,]+`)).first();
  await expect(figure).toBeVisible();
  const text = (await figure.textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("shop currency", () => {
  // Every test here mints its own shop, signs in as its owner, drives the
  // currency through settings and reads it back on reports — up to five full
  // page loads plus server-action writes, each with its own status-toast wait,
  // all inside the test's own budget. Measured idle at one worker before the
  // fixture was added: 7.8s, 9.2s, 5.9s. This override cannot mask a hang,
  // because a hang fails the 8s expect timeout inside it either way.
  test.setTimeout(60_000);

  /**
   * **The select keeps its own accessible name.** A warning about what
   * switching currency does was added beside it (issue #712) and briefly went
   * *inside* the `<Field>` — whose contract is a single control, so a second
   * child made it fall back to wrapping everything in the `<label>` and folded
   * the sentence into the select's accessible name. Every `getByLabel` in this
   * file timed out; nothing else in the suite noticed.
   */
  test("warns what changing the currency will do, without renaming the select", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await openSettingsRow(page, "Units");

    // The name is exactly the label, with nothing folded into it.
    await expect(page.getByLabel("Charge and display in", { exact: true })).toBeVisible();
    // A seeded shop has priced departures, so the warning is on screen — the
    // point being that it is beside the control, not part of it.
    await expect(page.getByText(/does not convert your prices/)).toBeVisible();
  });

  test("money follows the shop's currency instead of assuming dollars", async ({
    page,
    privateShop,
  }) => {
    await setCurrency(page, privateShop.slug, "eur");
    // Staff price entry first — we're already on settings; the price boxes
    // wait behind the "Rental prices" row. The box is prefixed with the
    // shop's own symbol, not a literal `$`.
    await openSettingsRow(page, "Rental prices");
    await expect(page.getByText("€", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$", { exact: true })).toHaveCount(0);

    await page.goto(`/shop/${privateShop.slug}/reports`);
    await expect(page.getByText(/€[\d,]+/).first()).toBeVisible();
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
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
  test("a zero-decimal currency is never divided by 100", async ({ page, privateShop }) => {
    await setCurrency(page, privateShop.slug, "eur");
    const euros = await reportedRevenueDigits(page, privateShop.slug, "€");
    expect(euros).toBeGreaterThan(0);

    await setCurrency(page, privateShop.slug, "jpy");
    // Whole-number entry: a ¥1,234.56 price does not exist, so the price box
    // must not invite one. setCurrency left us on settings; the box waits
    // behind the "Rental prices" row.
    await openSettingsRow(page, "Rental prices");
    await expect(page.getByLabel(/Full set/).first()).toHaveAttribute("step", "1");

    expect(await reportedRevenueDigits(page, privateShop.slug, "¥")).toBe(euros * 100);
  });

  /**
   * A price typed under one currency keeps its *number*, not its value — the
   * settings copy promises exactly this, and a shop that read "converted"
   * would mis-price its whole catalog. Worth an assertion because it's the
   * surprising half of the behaviour.
   */
  test("switching currency re-denominates a price rather than converting it", async ({
    page,
    privateShop,
  }) => {
    // Reads the seeded price rather than writing one — the claim is about what
    // a currency switch does to a number already on file, not about typing one.
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await openSettingsRow(page, "Rental prices");
    const seeded = await page
      .getByLabel(/Full set/)
      .first()
      .inputValue();
    expect(seeded).not.toBe("");

    await setCurrency(page, privateShop.slug, "eur");
    await openSettingsRow(page, "Rental prices");
    await expect(page.getByLabel(/Full set/).first()).toHaveValue(seeded);
  });
});
