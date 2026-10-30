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
      // Seeded demo references embed a random person UUID; stabilize only the unsaved visual value.
      const referenceNumber = row.getByLabel(staffCopy("staffing.credentials.identifier"));
      const originalReference = await referenceNumber.inputValue();
      const stableReference = originalReference.replace(
        /^(DEMO-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-)/i,
        (_match, prefix: string, separator: string) =>
          `${prefix}00000000-0000-4000-8000-000000000000${separator}`,
      );
      expect(stableReference).not.toBe(originalReference);
      expect(stableReference).toHaveLength(originalReference.length);
      await referenceNumber.fill(stableReference);
      await referenceNumber.evaluate((input) => input.blur());
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
