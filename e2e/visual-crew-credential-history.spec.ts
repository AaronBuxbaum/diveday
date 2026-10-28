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

test.describe("light mode", () => {
  test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
  test.describe("staff", () => {
    signedInAsOwner();
    test("a crew member opens the credential renewal editor", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const ledger = page.locator('details[id^="credentials-"]').first();
      await ledger.locator(":scope > summary").click();
      const row = ledger.locator("li").first();
      await row.getByText(staffCopy("staffing.credentials.editOrRenew")).click();
      await expect(
        row.getByRole("button", { name: staffCopy("staffing.credentials.saveRenewal") }),
      ).toBeVisible();
      const renewalDate = await row
        .getByLabel(staffCopy("staffing.credentials.renewsAt"))
        .boundingBox();
      const save = await row
        .getByRole("button", { name: staffCopy("staffing.credentials.saveRenewal") })
        .boundingBox();
      expect(renewalDate && save && save.y >= renewalDate.y + renewalDate.height).toBe(true);
      await capture(page, "team-credential-renewal-editor", "light");
    });
    test("Safety names unavailable crew evidence and links to current credentials", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/safety");
      await expect(page.getByText(/Credential history unavailable/).first()).toBeVisible();
      await expect(
        page
          .getByRole("link", { name: staffCopy("incidents.safety.currentCrewCredentials") })
          .first(),
      ).toBeVisible();
      await capture(page, "safety-crew-evidence-unavailable", "light");
    });
  });
});
