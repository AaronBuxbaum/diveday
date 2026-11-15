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
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
    signedInAsOwner();
    test("Garmin FIT profile with an unknown local clock", async ({ page }) => {
      await page.goto("/shop/blue-mantis/divers?q=Priya");
      await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
      await page.getByRole("link", { name: staffCopy("computerDives.title"), exact: true }).click();
      await page
        .getByLabel(staffCopy("computerDives.files"), { exact: true })
        .setInputFiles("src/lib/computer-import/fixtures/garmin-connect-summary-first.fit");
      await page
        .getByRole("button", { name: staffCopy("computerDives.preview"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: staffCopy("computerDives.previewHeading") }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: staffCopy("computerDives.confirmZone"), exact: true })
        .check();
      await page
        .getByRole("checkbox", { name: new RegExp(staffCopy("computerDives.confirmTarget")) })
        .check();
      await page
        .getByRole("button", { name: staffCopy("computerDives.commit"), exact: true })
        .click();
      await expect(page.getByText(staffCopy("computerDives.done"), { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: staffCopy("computerDives.cancel"), exact: true })
        .click();
      const history = page.getByRole("region", { name: staffCopy("computerDives.history") });
      await history.locator("summary").click();
      await expect(
        history.getByRole("img", { name: staffCopy("computerDives.profile") }),
      ).toBeVisible();
      await capture(page, "computer-dives-fit-profile", scheme);
    });
    test("computer import review", async ({ page }) => {
      await page.goto("/shop/blue-mantis/divers?q=Priya");
      await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
      await page.getByRole("link", { name: staffCopy("computerDives.title"), exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: staffCopy("computerDives.title") }),
      ).toBeVisible();
      await capture(page, "computer-dives-empty", scheme);
      const csv =
        "local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2031-10-14T23:40:00,unknown,Fixture Computer,visual-computer,1800,18\n";
      await page
        .getByLabel(staffCopy("computerDives.files"), { exact: true })
        .setInputFiles({ name: "computer.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page
        .getByRole("button", { name: staffCopy("computerDives.preview"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: staffCopy("computerDives.previewHeading") }),
      ).toBeVisible();
      await capture(page, "computer-dives-preview", scheme);
      await page
        .getByRole("button", { name: staffCopy("computerDives.cancel"), exact: true })
        .click();
      await page
        .getByLabel(staffCopy("computerDives.files"), { exact: true })
        .setInputFiles("src/lib/computer-import/fixtures/si.uddf");
      await page
        .getByRole("button", { name: staffCopy("computerDives.preview"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: staffCopy("computerDives.previewHeading") }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: staffCopy("computerDives.confirmZone"), exact: true })
        .check();
      await page
        .getByRole("checkbox", { name: new RegExp(staffCopy("computerDives.confirmTarget")) })
        .check();
      await page
        .getByRole("button", { name: staffCopy("computerDives.commit"), exact: true })
        .click();
      await expect(page.getByText(staffCopy("computerDives.done"), { exact: true })).toBeVisible();
      await capture(page, "computer-dives-result", scheme);
      await page
        .getByRole("button", { name: staffCopy("computerDives.cancel"), exact: true })
        .click();
      const history = page.getByRole("region", { name: staffCopy("computerDives.history") });
      await history.locator("summary").click();
      await expect(
        history.getByRole("img", { name: staffCopy("computerDives.profile") }),
      ).toBeVisible();
      await capture(page, "computer-dives-profile", scheme);
    });
  });
}
