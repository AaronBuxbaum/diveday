import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = staffTranslator("en-US");
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      test.use({
        storageState: { cookies: [], origins: [] },
        privateShopSlug: "trip-record-review",
      });
      test(`a wrapped trip links to its records (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const { boatOnTheWater } = (await seedFacts(
          request,
          [{ name: "boatOnTheWater", state: "home" }],
          { slug: privateShop.slug },
        )) as { boatOnTheWater: { tripId: string } };
        await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=wrapped`);
        await expect(
          page.getByRole("link", { name: t("desk.lostFound.heading"), exact: true }),
        ).toBeVisible();
        await capture(page, "trip-wrapped-record-links", scheme);
      });
    });
  });
}
