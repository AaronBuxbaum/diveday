/** The seeded checklist respects course context on the phone and printed pass. */
import { expect, test } from "./fixtures";
import { bookASeatAndOpenThread } from "./helpers";
import {
  bookAVisualRegressionSeat,
  capture,
  capturePrint,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.use(VISUAL_STEP_BOUNDS);
test.describe("light mode", () => {
  test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
  for (const intro of [false, true]) {
    test(`${intro ? "try-diver" : "ordinary diver"} packs the same bag on phone and paper`, async ({
      page,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      if (intro) {
        await page.goto("/s/blue-mantis/courses/discover-scuba-diving");
        await page.getByRole("link", { name: "Book this date" }).first().click();
        await bookASeatAndOpenThread(page, "First Dive Packing Student");
      } else {
        await bookAVisualRegressionSeat(page, "light");
      }
      const packing = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: diverCopy("trip.packTitle"), exact: true }),
        })
        .filter({ visible: true });
      await expect(packing.getByText("Swimsuit and towel", { exact: true })).toBeVisible();
      await expect(packing.getByText(/night before/i)).toHaveCount(0);
      await expect(packing.getByText(/certification card/i)).toHaveCount(0);
      await expect(packing.getByText(diverCopy("trip.packLogbook"), { exact: true })).toHaveCount(
        intro ? 0 : 1,
      );
      const name = intro ? "packing-try-diver" : "packing-ordinary-diver";
      await capture(page, name, "light");
      await page.emulateMedia({ media: "print" });
      const sheet = page
        .locator(".paper-sheet")
        .filter({ hasText: diverCopy("trip.arrivalHeading") });
      await expect(sheet).toBeVisible();
      const paperPacking = sheet
        .getByRole("heading", { name: diverCopy("trip.packTitle"), exact: true })
        .locator("..");
      await expect(paperPacking.getByText("Swimsuit and towel", { exact: true })).toBeVisible();
      await expect(paperPacking.getByText(/night before|certification card/i)).toHaveCount(0);
      await expect(
        paperPacking.getByText(diverCopy("trip.packLogbook"), { exact: true }),
      ).toHaveCount(intro ? 0 : 1);
      for (const format of ["Letter", "A4"] as const) {
        const pdf = await page.pdf({ format, preferCSSPageSize: true, printBackground: true });
        // Each bounded fixture fits one page; a stylesheet sibling used to
        // trigger a forced break before the first actual sheet.
        expect(pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).toHaveLength(1);
      }
      await capturePrint(page, `${name}-pass`);
    });
  }
});
