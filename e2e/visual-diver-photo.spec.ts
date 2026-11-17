import { diverTranslator } from "../src/i18n/messages";
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
const t = diverTranslator("en-US");
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "diver-photo-review",
      privateShopFacts: ["diverPhotoReadiness"],
      privateShopSignIn: false,
    });
    test(`a diver selects their photo (${scheme})`, async ({ page, privateShop }) => {
      const { delivered } = privateShop.values.diverPhotoReadiness as { delivered: string };
      await page.goto(`/ready/${delivered}`);
      await expect(page.getByRole("heading", { name: t("ready.ownPhoto.heading") })).toBeVisible();
      await page
        .getByLabel(t("ready.ownPhoto.choose"))
        .setInputFiles("public/demo-divers/priya-sharma.webp");
      await expect(page.locator('img[src^="blob:"]')).toBeVisible();
      await capture(page, "diver-own-photo-selected", scheme);
    });
  });
}
