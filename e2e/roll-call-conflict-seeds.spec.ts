import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { offlineCopySaved } from "./helpers";

const staff = staffTranslator("en-US");

// Each case mints a new private shop and independent UUIDs. The visual suite
// owns pixels; these checks exercise the same live and saved evidence at both widths.
for (const role of ["diver", "crew"] as const) {
  test.describe(`${role} conflict ordering across fresh seeds`, () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      privateShopFacts: [{ name: "causalRollCallConflict", role }],
    });
    for (const seed of [1, 2, 3]) {
      test(`seed ${seed} retains both statements on live and saved views`, async ({
        page,
        privateShop,
      }) => {
        const fact = privateShop.values.causalRollCallConflict as {
          tripId: string;
          fullName: string;
          evidenceIds: string[];
        };
        expect(new Set(fact.evidenceIds).size).toBe(2);
        const expected = [staff("manifest.conflicts.missing"), staff("manifest.conflicts.aboard")];
        const checkAtBothWidths = async () => {
          for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 800 });
            const resolve = page.getByRole("button", {
              name: staff("manifest.conflicts.confirmAboard"),
              exact: true,
            });
            await expect(resolve).toBeVisible();
            const panel = page.locator("details").filter({ has: resolve });
            await expect(panel).toContainText(fact.fullName);
            await expect(panel.locator("ul > li > p.font-medium")).toHaveText(expected);
          }
        };
        await page.goto(
          `/shop/${privateShop.slug}/trips/${fact.tripId}/manifest?checkpoint=after_dive_1`,
        );
        await checkAtBothWidths();
        await offlineCopySaved(page);
        await page.goto(`/offline-manifest?trip=${fact.tripId}&checkpoint=after_dive_1`);
        await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
        await checkAtBothWidths();
      });
    }
  });
}
