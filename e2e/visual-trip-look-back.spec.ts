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
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      test(`a historical check-in points to open close-out items (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const { boatOnTheWater } = (await seedFacts(
          request,
          [{ name: "boatOnTheWater", state: "unfinished" }],
          { slug: privateShop.slug },
        )) as { boatOnTheWater: { tripId: string } };
        await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=checkin`);
        await expect(
          page.getByRole("link", {
            name: staffCopy("trips.clock.wrapped.lookBackOpen", { count: 2 }),
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: staffCopy("trips.clock.wrapped.reportOne") }),
        ).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        const link = page.getByRole("link", {
          name: staffCopy("trips.clock.wrapped.lookBackOpen", { count: 2 }),
        });
        const bounds = await link.boundingBox();
        const navBounds = await page.locator("nav[data-staff-nav]:visible").boundingBox();
        if (!bounds || !navBounds)
          throw new Error("The close-out link or staff navigation is missing");
        expect(bounds.y + bounds.height).toBeLessThan(navBounds.y);
        const rollCallBounds = await page
          .getByRole("link", { name: staffCopy("trips.clock.rollCall"), exact: true })
          .first()
          .boundingBox();
        if (!rollCallBounds) throw new Error("The roll call door is missing");
        expect(rollCallBounds.y + rollCallBounds.height).toBeLessThan(navBounds.y);
        await capture(page, "trip-checkin-look-back", scheme);
      });
    });
  });
}
