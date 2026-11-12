import type { Locator } from "@playwright/test";
import { demoIllustration } from "../src/content/demo-illustrations";
import { diverTranslator } from "../src/i18n/messages";
import { expect, READ_ONLY, test } from "./fixtures";
import { settleCaptureFonts } from "./visual-harness";

/**
 * Read-only artwork review, outside the CI visual baseline. Do not install the
 * visual build guard: its approved shop-photo tiling deliberately hides these
 * scenes, including their reuse on course cards (H-20261023-shop-photo-tile-in).
 */
test.use({ colorScheme: "light" });

/** Same real-image check as storefront-brand/boat-photo; the 8×6 tile cannot pass. */
async function loadedScene(photo: Locator): Promise<string> {
  await photo.scrollIntoViewIfNeeded();
  await expect(photo).toHaveJSProperty("complete", true);
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(8);
  const image = await photo.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    return { source: image.currentSrc, height: image.naturalHeight };
  });
  expect(image.height, image.source).toBeGreaterThan(6);
  const url = new URL(image.source);
  return url.pathname === "/_next/image" ? (url.searchParams.get("url") ?? "") : url.pathname;
}

for (const width of [390, 1280]) {
  for (const surface of ["shopfront", "course-catalog"] as const) {
    test(
      `real generated demo artwork on ${surface} at ${width}`,
      { tag: READ_ONLY },
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        const base = "/s/blue-mantis";
        await page.goto(surface === "shopfront" ? base : `${base}/courses`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const photos = page
          .locator('main img[src*="demo-shop/generated"], main img[src*="demo-shop%2Fgenerated"]')
          .filter({ visible: true });
        await expect(photos).not.toHaveCount(0);
        await expect(photos.first()).toBeVisible();
        const paths = new Set<string>();
        for (const photo of await photos.all()) paths.add(await loadedScene(photo));
        for (const path of paths) expect(path).toMatch(/^\/demo-shop\/generated\/[a-z]+\.webp$/);

        if (surface === "shopfront") {
          expect(paths).toEqual(
            new Set(
              ["boat", "dock", "briefing", "student", "reef", "oxygen"].map(
                (scene) => `/demo-shop/generated/${scene}.webp`,
              ),
            ),
          );
          await expect(page.getByAltText(demoIllustration("boat").alt)).toBeVisible();
          const strip = page.getByRole("list", {
            name: diverTranslator("en-US")("schedule.shopPhotos"),
          });
          await expect(strip.locator("img")).toHaveCount(5);
          await strip.evaluate((element) => {
            element.scrollLeft = 0;
          });
        } else {
          for (const [course, scene] of [
            ["discover-scuba-diving", "student"],
            ["open-water-diver", "student"],
            ["emergency-oxygen-provider", "oxygen"],
          ] as const) {
            const coursePath = `${base}/courses/${course}`;
            const image = page.locator(
              `main a[href="${coursePath}"] img, main a[href^="${coursePath}#"] img`,
            );
            await expect(image).toHaveCount(1);
            expect(await loadedScene(image)).toBe(demoIllustration(scene).url);
          }
        }
        expect(await settleCaptureFonts(page)).toBe("ready");
        await page.evaluate(() => window.scrollTo(0, 0));
        const name = `review-only-real-art-${surface}-${width}.png`;
        const path = testInfo.outputPath(name);
        await page.screenshot({ path, fullPage: true, animations: "disabled" });
        await testInfo.attach(name, { path, contentType: "image/png" });
      },
    );
  }
}
