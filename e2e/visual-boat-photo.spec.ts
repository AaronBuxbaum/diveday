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
      const opener = page.getByRole("button", { name: boat.name, exact: true });
      const photo = opener.locator("img");
      await expect(photo).toBeVisible();
      await photo.scrollIntoViewIfNeeded();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-storefront", scheme);
      await opener.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const enlarged = dialog.getByRole("img", { name: boat.name });
      await expect(enlarged).toBeVisible();
      await expect
        .poll(() => enlarged.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await capture(page, "boat-photo-enlarged", scheme);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await page.goto(`/s/${privateShop.slug}/trips/${trip.id}`);
      const tripPhoto = page.getByRole("button", { name: boat.name, exact: true }).locator("img");
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
