import { expect, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
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
      const seeded = await request.post(
        `/api/test/seed-trouble-states?settingsState=boat-photo&shop=${privateShop.slug}`,
      );
      expect(seeded.ok()).toBe(true);
      const { boat, trip } = (await seeded.json()) as {
        boat: { name: string };
        trip: { id: string };
      };
      await page.goto(`/s/${privateShop.slug}`);
      const photo = page.getByRole("img", { name: boat.name });
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-storefront", scheme);
      await page.goto(`/s/${privateShop.slug}/trips/${trip.id}`);
      const tripPhoto = page.getByRole("img", { name: boat.name });
      await expect(tripPhoto).toBeVisible();
      await expect
        .poll(() => tripPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-trip", scheme);
    });
  });
}
