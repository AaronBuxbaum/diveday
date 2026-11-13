import {
  DEMO_MEDICAL_ALERT,
  DEMO_MEDICAL_ALERT_DIVER,
  DEMO_MEDICAL_ALERT_TRIP,
} from "../src/db/seed-medical-alert";
import { expect, signedInAs, test } from "./fixtures";
import { manifestRow, openManifestPerson, openTripFromBoard, openTripTab } from "./helpers";
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
    test.describe("boat validation", () => {
      test.use({ privateShopSlug: "visual-toast-validation" });
      test(`a refused working channel keeps its field reason and keyboard toast (${scheme})`, async ({
        page,
        privateShop,
      }) => {
        await page.goto(`/shop/${privateShop.slug}/boats`);
        const row = page.locator('details[id^="boat-"]:not(#boat-new)').first();
        await row.locator("summary").click();
        await row.getByLabel(staffCopy("boats.workingChannelLabel")).fill("16");
        await row.getByRole("button", { name: staffCopy("boats.submit"), exact: true }).click();
        const toast = page.getByRole("alert").and(page.locator('[tabindex="0"]'));
        await expect(toast).toHaveText(staffCopy("boats.boatChannelDistress"));
        await toast.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(toast).toBeFocused();
        await capture(page, "boats-validation-keyboard-toast", scheme);
      });
    });
    test.describe("medical refusal", () => {
      signedInAs("instructor");
      test(`an early emergency read keeps its timed refusal and withholds medical words (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, DEMO_MEDICAL_ALERT_TRIP);
        await openTripTab(page, "Manifest");
        await openManifestPerson(manifestRow(page, DEMO_MEDICAL_ALERT_DIVER));
        const sheet = page.getByRole("dialog");
        await sheet
          .getByRole("button", { name: staffCopy("manifest.medicalAlertEmergencyOffer") })
          .click();
        await sheet
          .getByRole("button", { name: staffCopy("manifest.medicalAlertEmergencyConfirm") })
          .click();
        const toast = sheet.getByRole("alert").and(page.locator('[tabindex="0"]'));
        await expect(toast).toHaveText(staffCopy("manifest.medicalAlertEmergencyNotYet"));
        await expect(sheet.getByText(DEMO_MEDICAL_ALERT)).toHaveCount(0);
        await toast.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(toast).toBeFocused();
        await capture(page, "medical-refusal-keyboard-toast", scheme);
      });
    });
  });
}
