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
      await page.getByText(staffCopy("staffing.publicProfile.heading"), { exact: true }).click();
      await capture(page, "account-public-profile", scheme);
    });
    test.describe("private introduction", () => {
      // privateShop signs into its minted owner; a canonical owner session
      // redirects /sign-in to /shop before the credential form can render.
      test.use({
        storageState: { cookies: [], origins: [] },
        privateShopSlug: "public-profile-preview",
      });
      test("self-authored public introduction", async ({ page, privateShop }) => {
        await page.goto(`/shop/${privateShop.slug}/me/security`);
        await page.getByText(staffCopy("staffing.publicProfile.heading"), { exact: true }).click();
        await page
          .getByRole("checkbox", { name: staffCopy("staffing.publicProfile.consent") })
          .check();
        await page
          .getByRole("textbox", { name: staffCopy("staffing.publicProfile.firstName") })
          .fill("Ocean Guide");
        await page
          .getByRole("textbox", { name: staffCopy("staffing.publicProfile.role") })
          .fill("Instructor");
        await page
          .getByRole("textbox", { name: staffCopy("staffing.publicProfile.languages") })
          .fill("English, Español");
        await page
          .getByRole("textbox", { name: staffCopy("staffing.publicProfile.description") })
          .fill("I love the early reef.");
        await page
          .getByRole("button", { name: staffCopy("staffing.crewConsent.save"), exact: true })
          .click();
        await expect(page.getByText(staffCopy("staffing.publicProfile.saved"))).toBeVisible();
        await page.goto(`/s/${privateShop.slug}`);
        await expect(page.getByText("I love the early reef.", { exact: true })).toBeVisible();
        await capture(page, "shopfront-public-introduction", scheme);
      });
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
