import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { saveReadyRental } from "./ready-rental-price-helpers";

const t = diverTranslator("en-US");

test("a saved rental is added to the prep page estimate and survives reload", async ({ page }) => {
  await saveReadyRental(page);
  await page.reload();
  await expect(
    page.getByText(t("ready.estimatedAtShopTotal", { amount: "$140.00" }), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(t("trip.providedItems.tanks"), { exact: true })).toBeVisible();
  await expect(
    page.getByText(t("trip.providedItems.tanksAndWeights"), { exact: true }),
  ).toHaveCount(0);
});
