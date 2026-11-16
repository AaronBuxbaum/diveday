import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
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
for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test.describe(viewport.name, () => {
    signedInAsOwner();
    test.use({ privateShopFacts: ["operationsVisual"] });
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "light",
    });
    test("local amount due and original-receipt day summary", async ({ page, privateShop }) => {
      await page.goto(`/shop/${privateShop.slug}/orders?purchase=1`);
      const form = page.getByRole("form", { name: t("orders.purchase.title"), exact: true });
      await form.getByRole("radio", { name: t("orders.localDue.open"), exact: true }).check();
      await form.locator('[name="description-0"]').fill("Regulator rental");
      await form.locator('[name="unitAmount-0"]').fill("25");
      await capture(page, `local-amount-due-${viewport.name}`, "light");
      await page.goto(`/shop/${privateShop.slug}/orders`);
      await page.getByText(t("orders.purchaseDay.title"), { exact: false }).click();
      await expect(page.getByText(t("orders.purchaseDay.scope"), { exact: true })).toBeVisible();
      await expect(page.getByText("$50.00", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("$10.00", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: t("orders.purchaseDay.returns"), exact: true }),
      ).toBeVisible();
      await capture(page, `recorded-receipt-day-${viewport.name}`, "light");
      const fact = privateShop.values.operationsVisual as { orderId: string };
      await page.goto(`/shop/${privateShop.slug}/orders/${fact.orderId}`);
      await expect(page.getByText("COUNTER-1042", { exact: false })).toBeVisible();
      await capture(page, `recorded-receipt-return-${viewport.name}`, "light");
    });
  });
}
