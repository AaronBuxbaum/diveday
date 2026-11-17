import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
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

async function saveWelcome(page: Page, slug: string) {
  await page.goto(`/shop/${slug}/settings/profile`);
  await page
    .getByLabel(staffCopy("settings.main.profile.welcomeText"))
    .fill("Join us for a day on the reef. We look forward to diving with you.");
  await page.getByLabel(staffCopy("settings.main.profile.welcomeSigner")).fill("Ana");
  await page.getByRole("button", { name: staffCopy("settings.main.profile.submit") }).click();
  await expect(page.getByRole("status")).toContainText(
    staffCopy("settings.main.notice.profileSaved"),
  );
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — shop welcome`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "welcome-review",
    });
    test("saved welcome profile", async ({ page, privateShop }) => {
      await saveWelcome(page, privateShop.slug);
      await capture(page, "settings-owner-welcome", scheme);
    });
    test("saved welcome storefront", async ({ page, privateShop }) => {
      await saveWelcome(page, privateShop.slug);
      await page.goto(`/s/${privateShop.slug}`);
      await expect(page.getByText("Ana", { exact: true })).toBeVisible();
      await capture(page, "shopfront-owner-welcome", scheme);
    });
  });
}
