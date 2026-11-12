import { expect, signedInAsOwner, test } from "./fixtures";
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
    signedInAsOwner();
    test("account public visibility controls", async ({ page }) => {
      await page.goto("/shop/blue-mantis/me/security");
      await page.getByText(staffCopy("staffing.crewConsent.rowLabel"), { exact: true }).click();
      await expect(
        page.getByRole("checkbox", { name: staffCopy("staffing.crewConsent.label") }),
      ).toBeVisible();
      await capture(page, "account-public-profile", scheme);
    });
    test("personal crew schedule", async ({ page }) => {
      await page.goto("/shop/blue-mantis/staffing");
      const scope = page.getByRole("combobox", { name: staffCopy("staffing.filter.person") });
      await scope.selectOption("me");
      await expect(scope).toHaveValue("me");
      await capture(page, "crew-personal-schedule", scheme);
    });
  });
}
