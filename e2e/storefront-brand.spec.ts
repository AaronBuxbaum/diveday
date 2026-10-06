import { MINTED_DEMO_BRAND_COLOR } from "../src/db/seed";
import { deriveBrandTheme, deriveDarkBrandTheme } from "../src/lib/brand";
import { expectNoA11yViolations } from "./a11y-scan";
import { expect, test } from "./fixtures";

/**
 * Harbor (ADR 20260901-diveday-reimagined, decision 2): the storefront and the
 * embed wear the shop's brand. The canonical demo, Blue Mantis, carries a cover
 * photo, three badges and an opening year but no colour or face of its own —
 * it wears Logbook's (ADR 20261001-logbook, decision 8) — so the colour is
 * proved on a minted shop dressed in the brand fixture (`privateShopBrand`,
 * `MINTED_DEMO_BRAND` in `src/db/seed.ts`): mantis green and Bricolage.
 *
 * The colour on screen is the derivation's, not the row's: `deriveBrandTheme`
 * moves a fill that would fail AA on the ground or on its own tint, so every
 * expectation here is the derivation's output rather than a literal.
 */
test.describe("the storefront wears the shop's brand", () => {
  test("the badge wall and the cover photo lead", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: "Blue Mantis Divers" })).toBeVisible();
    await expect(
      page.getByAltText("Elkhorn coral on Molasses Reef, sunlight from above"),
    ).toBeVisible();
    await expect(page.getByText("Since 1998")).toBeVisible();
    await expect(page.getByText("PADI 5 Star Dive Center")).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings by DiveDay" })).toBeVisible();
  });

  test.describe("a shop with a color of its own", () => {
    test.use({ privateShopBrand: true });

    test("paints its storefront and its embed in that color", async ({ page, privateShop }) => {
      test.setTimeout(45_000);
      const expected = deriveBrandTheme(MINTED_DEMO_BRAND_COLOR).primary;

      await page.goto(`/s/${privateShop.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("style[data-brand-style]")).toHaveCount(1);
      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      expect(primary).toBe(expected);

      await page.goto(`/s/${privateShop.slug}?embed=1`);
      await expect(page.getByText("Powered by DiveDay")).toBeVisible();
      await expect(page.getByText("Since 1998")).toHaveCount(0);
      const embedPrimary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      expect(embedPrimary).toBe(expected);
    });
  });

  /**
   * **The storefront at depth, wearing the shop's own colour** — the one
   * dark-scheme axe scan in the suite (issue #1265), moved here from
   * `a11y.spec.ts` when the canonical demo stopped carrying a colour, because
   * that file's `signedInAsOwner()` cannot share a context with a minted shop.
   *
   * A branded storefront rendered sub-AA in dark mode for as long as it did
   * because `BrandStyle` emitted one `:root` block that won in *both* schemes:
   * mantis green arrived at depth as its light-mode derivation, 3.39:1 on the
   * dark ground. `deriveDarkBrandTheme` is the fix; this is what would have
   * caught it. The scheme rides the context (`test.use`), not an
   * `emulateMedia` on a live page, which raced the first paint (#1940).
   */
  test.describe("in the dark", () => {
    test.use({ privateShopBrand: true, colorScheme: "dark" });

    test("reads at depth in the shop's own color", async ({ page, privateShop }) => {
      test.setTimeout(60_000);
      await page.goto(`/s/${privateShop.slug}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // A scan over DiveDay's own dark tokens would pass just as well, so prove
      // the shop's colour is what is being scanned.
      await expect(page.locator("style[data-brand-style]")).toHaveCount(1);
      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      expect(primary, "the dark block did not win over globals.css's dark palette").toBe(
        deriveDarkBrandTheme(MINTED_DEMO_BRAND_COLOR).primary,
      );
      await expectNoA11yViolations(page);
    });
  });
});
