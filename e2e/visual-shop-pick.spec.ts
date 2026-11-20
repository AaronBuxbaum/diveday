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

/** The shop's pick (#4823): chosen on the profile page, drawn above the schedule. One theme. */
test.describe("light mode — shop pick", () => {
  test.use({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    privateShopSlug: "pick-review",
  });

  test("a chosen departure leads the storefront", async ({ page, privateShop }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/profile`);
    const pick = page.getByLabel(staffCopy("settings.main.profile.pick"));
    // The first real option after "None": the shop's next public departure.
    await pick.selectOption({ index: 1 });
    await page.getByRole("button", { name: staffCopy("settings.main.profile.submit") }).click();
    await expect(page.getByRole("status")).toContainText(
      staffCopy("settings.main.notice.profileSaved"),
    );

    await page.goto(`/s/${privateShop.slug}`);
    const card = page.getByRole("region", { name: "Our pick" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("link")).toHaveAttribute("href", /\/trips\/.*#book$/);
    await capture(page, "shopfront-owner-pick", "light");
  });
});
