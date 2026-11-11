/** A real recorded purchase with historical Square evidence, after disconnect. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = staffTranslator("en-US");
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({
      colorScheme: scheme,
      privateShopSlug: "square-receipt-review",
      privateShopFacts: ["disconnectedSquareReceipt"],
      privateShopDemo: false,
    });
    test(`Square receipt remains readable after disconnect (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      const fact = privateShop.values.disconnectedSquareReceipt as { orderId: string };
      await page.goto(`/shop/${privateShop.slug}/orders/${fact.orderId}`);
      await expect(
        page.getByRole("heading", { name: t("integrations.square.receiptTitle") }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: t("integrations.square.recheck") }),
      ).toBeDisabled();
      await capture(page, "order-square-receipt-disconnected", scheme);
    });
  });
}
