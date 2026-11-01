import { MINTED_DEMO_BRAND_COLOR } from "../src/db/seed-identifiers";
import { DEMO_SHOP_BRAND } from "../src/db/seed-shop-brand";
import { diverTranslator } from "../src/i18n/messages";
import { deriveBrandTheme, deriveDarkBrandTheme } from "../src/lib/brand";
import { expect, test } from "./fixtures";

/**
 * Harbor (ADR 20260901-diveday-reimagined, decision 2): the storefront and the
 * embed wear the shop's brand. The canonical demo, Blue Mantis, wears a full
 * profile in its own blue (`src/db/seed-shop-brand.ts`), so the colour is
 * proved on a minted shop dressed in a different one (`privateShopBrand`,
 * `MINTED_DEMO_BRAND` in `src/db/seed.ts`): mantis green and Bricolage, which
 * only the shop's own choice can explain.
 *
 * The colour on screen is the derivation's, not the row's: `deriveBrandTheme`
 * moves a fill that would fail AA on the ground or on its own tint, so every
 * expectation here is the derivation's output rather than a literal.
 */
test.describe("the storefront wears the shop's brand", () => {
  test("the badge wall and the cover photo lead", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    await expect(page.getByRole("heading", { level: 2, name: "Blue Mantis Divers" })).toBeVisible();
    await expect(
      page.getByAltText("Elkhorn coral on Molasses Reef, sunlight from above"),
    ).toBeVisible();
    await expect(page.getByText("Since 1998")).toBeVisible();
    await expect(page.getByText("PADI 5 Star Dive Center")).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings by DiveDay" })).toBeVisible();
  });

  /**
   * **The real photos load** (H-20261023-shop-photo-tile-in). Every visual capture answers the strip's
   * photos with one flat tile (`tileShopPhotos`, e2e/visual-harness.ts), so
   * this is the one test that sees the files themselves: each decodes to a
   * real size and carries its alt attribute, empty because the strip is
   * decorative (`ShopPhotoStrip`).
   */
  test("the photo strip's real photos load, each at a size and with its alt", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto("/s/blue-mantis");
    const strip = page.getByRole("list", { name: diverTranslator("en-US")("schedule.shopPhotos") });
    const photos = strip.locator("img");
    await expect(photos).toHaveCount(DEMO_SHOP_BRAND.shopfrontPhotoUrls.length);
    for (const photo of await photos.all()) {
      await photo.scrollIntoViewIfNeeded();
      await expect(photo).toHaveAttribute("alt", "");
      await expect(photo).toHaveJSProperty("complete", true);
      const size = await photo.evaluate((image: HTMLImageElement) => ({
        src: image.currentSrc,
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
      expect(size.width, size.src).toBeGreaterThan(64);
      expect(size.height, size.src).toBeGreaterThan(64);
    }
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
      await expect(page.getByText("Bookings by DiveDay")).toBeVisible();
      await expect(page.getByText("Since 1998")).toHaveCount(0);
      const embedPrimary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      expect(embedPrimary).toBe(expected);
    });
  });

  /**
   * **The storefront at depth, wearing the shop's own colour.** A branded
   * storefront rendered sub-AA in dark mode for as long as it did because
   * `BrandStyle` emitted one `:root` block that won in *both* schemes: mantis
   * green arrived at depth as its light-mode derivation, 3.39:1 on the dark
   * ground (issue #1265). `deriveDarkBrandTheme` is the fix; this proves its
   * block is the one that wins. The scheme rides the context (`test.use`), not
   * an `emulateMedia` on a live page, which raced the first paint (#1940).
   */
  test.describe("in the dark", () => {
    test.use({ privateShopBrand: true, colorScheme: "dark" });

    test("reads at depth in the shop's own color", async ({ page, privateShop }) => {
      await page.goto(`/s/${privateShop.slug}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("style[data-brand-style]")).toHaveCount(1);
      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      expect(primary, "the dark block did not win over globals.css's dark palette").toBe(
        deriveDarkBrandTheme(MINTED_DEMO_BRAND_COLOR).primary,
      );
    });
  });
});
