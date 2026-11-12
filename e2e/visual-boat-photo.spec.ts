import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: `boat-photo-visual-${scheme}`,
    });
    test(`a boat photo appears on the storefront and its departure (${scheme})`, async ({
      page,
      request,
      privateShop,
    }) => {
      const { boatPhoto } = await seedFacts(request, ["boatPhoto"], { slug: privateShop.slug });
      const { boat, trip } = boatPhoto as {
        boat: { id: string; name: string };
        trip: { id: string };
      };
      await page.goto(`/s/${privateShop.slug}`);
      const photo = page.getByRole("img", { name: boat.name });
      await expect(photo).toBeVisible();
      await photo.scrollIntoViewIfNeeded();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-storefront", scheme);
      await page.goto(`/s/${privateShop.slug}/trips/${trip.id}`);
      const tripPhoto = page.getByRole("img", { name: boat.name });
      await expect(tripPhoto).toBeVisible();
      await tripPhoto.scrollIntoViewIfNeeded();
      await expect
        .poll(() => tripPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-trip", scheme);
      await page.goto(`/shop/${privateShop.slug}/boats`);
      const row = page.locator(`#boat-${boat.id}`);
      await row.locator("summary").click();
      await expect(
        row.getByRole("checkbox", { name: staffCopy("boats.removePhoto") }),
      ).toBeAttached();
      await capture(page, "boat-photo-editor", scheme);
    });
  });
}
