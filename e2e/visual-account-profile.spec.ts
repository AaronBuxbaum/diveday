import { expect, signedInAsOwner, test } from "./fixtures";
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
    signedInAsOwner();
    test.describe("public visibility", () => {
      test.use({
        storageState: { cookies: [], origins: [] },
        privateShopSlug: "public-visibility-review",
      });
      test("account public visibility controls", async ({ page, privateShop }) => {
        // Better Auth mints session timestamps on the wall clock, while the
        // visual server is frozen. Pin only this private shop's display time.
        await seedFacts(page.request, ["staffSessionsSeenNow"], { slug: privateShop.slug });
        await page.goto(`/shop/${privateShop.slug}/me/security`);
        await expect(
          page.getByText(
            staffCopy("settings.security.sessions.group", { count: 1, when: "today" }),
          ),
        ).toBeVisible();
        await page.getByText(staffCopy("staffing.crewConsent.rowLabel"), { exact: true }).click();
        await expect(
          page.getByRole("checkbox", { name: staffCopy("staffing.crewConsent.label") }),
        ).toBeVisible();
        await page.getByText(staffCopy("staffing.publicProfile.heading"), { exact: true }).click();
        await capture(page, "account-public-profile", scheme);
      });
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
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/shop/blue-mantis/staffing" && url.searchParams.get("person") === "me",
      );
      await expect(scope.locator("..")).toHaveAttribute("aria-busy", "false");
      await expect(scope).toHaveValue("me");
      await capture(page, "crew-personal-schedule", scheme);
    });
  });
}
