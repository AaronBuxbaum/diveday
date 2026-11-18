import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SPANISH,
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
    for (const locale of ["en-US", SPANISH] as const) {
      test.describe(`SSI guidance ${locale}`, () => {
        test.use({ locale });
        test("SSI guide distinguishes LogTRAK sharing from DiveDay import", async ({ page }) => {
          const words = staffTranslator(locale);
          await page.goto("/shop/blue-mantis/divers?q=Amara");
          await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
          await page.getByRole("link", { name: words("computerDives.title"), exact: true }).click();
          await page
            .getByLabel(words("computerDives.provider"), { exact: true })
            .selectOption("ssi");
          await expect(
            page.getByText(words("computerDives.providers.ssi.hint"), { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: words("computerDives.providerGuide"), exact: true }),
          ).toHaveAttribute(
            "href",
            "https://www.divessi.com/en/blog/blog/blog/scubapro-logtrak-myssi-app-integration-10251.html",
          );
          await capture(page, "computer-dives-ssi-guidance", scheme, {
            ...(locale === SPANISH ? { locale: SPANISH } : {}),
          });
        });
      });
    }
    test("Garmin FIT profile with an unknown local clock", async ({ page }) => {
      await page.goto("/shop/blue-mantis/divers?q=Amara");
      await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
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
        .getByRole("button", { name: staffCopy("computerDives.importMore"), exact: true })
        .click();
      const history = page.getByRole("region", { name: staffCopy("computerDives.history") });
      await history.locator("summary").click();
      await expect(
        history.getByRole("img", { name: staffCopy("computerDives.profile") }),
      ).toBeVisible();
      await capture(page, "computer-dives-fit-profile", scheme);
    });
    test("online logbook beta mapping, date-only and archive review", async ({ page }) => {
      await page.goto("/shop/blue-mantis/divers?q=Amara");
      await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
      await page.getByRole("link", { name: staffCopy("computerDives.title"), exact: true }).click();
      await page
        .getByLabel(staffCopy("computerDives.provider"), { exact: true })
        .selectOption("padi");
      await page.getByLabel(staffCopy("computerDives.files"), { exact: true }).setInputFiles({
        name: "personal-logbook.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Date,Minutes,Feet,Entry\n14/10/2031,30,60,my-entry\n"),
      });
      await page
        .getByRole("checkbox", { name: staffCopy("computerDives.mapCsv"), exact: true })
        .check();
      await expect(
        page.getByLabel(staffCopy("computerDives.mapping.date"), { exact: true }),
      ).toBeEnabled();
      await page
        .getByLabel(staffCopy("computerDives.mapping.date"), { exact: true })
        .selectOption("Date");
      await page
        .getByLabel(staffCopy("computerDives.mapping.dateFormat"), { exact: true })
        .selectOption("dmy");
      await page
        .getByLabel(staffCopy("computerDives.mapping.duration"), { exact: true })
        .selectOption("Minutes");
      await page
        .getByLabel(staffCopy("computerDives.mapping.maxDepth"), { exact: true })
        .selectOption("Feet");
      await page
        .getByLabel(staffCopy("computerDives.mapping.sourceId"), { exact: true })
        .selectOption("Entry");
      await page
        .getByLabel(staffCopy("computerDives.mapping.durationUnit"), { exact: true })
        .selectOption("minutes");
      await page
        .getByLabel(staffCopy("computerDives.mapping.depthUnit"), { exact: true })
        .selectOption("ft");
      await capture(page, "computer-dives-beta-csv-mapping", scheme);
      await page
        .getByRole("button", { name: staffCopy("computerDives.preview"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: staffCopy("computerDives.previewHeading") }),
      ).toBeFocused();
      await expect(
        page.getByText(staffCopy("computerDives.warningCodes.date_only"), { exact: true }).first(),
      ).toBeVisible();
      await capture(page, "computer-dives-beta-date-only", scheme);
      await page
        .getByRole("button", { name: staffCopy("computerDives.cancel"), exact: true })
        .click();
      await page
        .getByLabel(staffCopy("computerDives.provider"), { exact: true })
        .selectOption("oceanic");
      await page
        .getByLabel(staffCopy("computerDives.files"), { exact: true })
        .setInputFiles("src/lib/computer-import/fixtures/multi-entry.zip");
      await page
        .getByRole("button", { name: staffCopy("computerDives.preview"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: staffCopy("computerDives.previewHeading") }),
      ).toBeFocused();
      await expect(
        page.getByRole("checkbox", { name: new RegExp(staffCopy("computerDives.selected")) }),
      ).toHaveCount(2);
      await capture(page, "computer-dives-beta-zip-preview", scheme);
    });
    test("computer import review", async ({ page }) => {
      await page.goto("/shop/blue-mantis/divers?q=Amara");
      await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
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
        .getByRole("button", { name: staffCopy("computerDives.importMore"), exact: true })
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
