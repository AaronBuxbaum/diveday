/** The staff introduction uses the shared growing textarea at its own row count. */
import { expect, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({
  ...VISUAL_STEP_BOUNDS,
  colorScheme: "light",
  privateShopSlug: "reef-garden-dive-center",
  storageState: { cookies: [], origins: [] },
});

test("light mode staff public introduction editor with a filled description", async ({
  page,
  privateShop,
}) => {
  await page.goto(`/shop/${privateShop.slug}/me/security`);
  await expect(page.getByText("Reef Garden Dive Center", { exact: true }).first()).toBeVisible();
  const description = page.locator('textarea[name="profileDescription"]');
  const disclosure = page.locator("details").filter({ has: description });
  await disclosure.locator(":scope > summary").click();
  await description.fill(
    "Enjoys calm reef dives and helping new divers find a comfortable pace. Happy to talk through the plan before boarding.",
  );
  await expect(description).toBeVisible();
  await capture(page, "staff-public-profile-editor", "light", {
    beforeScreenshot: async () => {
      await expect(page.locator("[data-identity-menu] [data-chrome-shop-name]").first()).toHaveText(
        "Reef Garden Dive Center",
      );
    },
  });
});
