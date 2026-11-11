/** Filled statements and the external balance form on a Stripe deposit. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { openRosterDetails } from "./helpers";
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
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "collection-review-divers",
    });
    test.describe("billing statement", () => {
      test.use({ privateShopFacts: ["collectionBilling"], privateShopDemo: false });
      test(`native collection statements and refund credits (${scheme})`, async ({
        page,
        privateShop,
      }) => {
        await page.goto(`/shop/${privateShop.slug}/settings/billing`);
        await expect(page.getByText(t("billing.plan.refundCredit"), { exact: true })).toBeVisible();
        await expect(
          page.getByText(t("billing.plan.currencyNotConfigured"), { exact: true }),
        ).toBeVisible();
        await capture(page, "billing-recorded-collections", scheme);
      });
    });
    test.describe("external partial refund", () => {
      test.use({ privateShopFacts: ["mixedCashReceipt"] });
      test(`record an external partial return (${scheme})`, async ({ page, privateShop }) => {
        const fact = privateShop.values.mixedCashReceipt as { tripId: string; name: string };
        await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
        const row = page.locator("li").filter({ hasText: fact.name }).filter({ visible: true });
        await openRosterDetails(row);
        await row
          .getByRole("combobox", { name: t("trips.roster.paymentStatusLabel") })
          .selectOption("refunded");
        await expect(row.getByLabel(t("trips.roster.paymentRefundAmountLabel"))).toBeVisible();
        await capture(page, "roster-external-partial-refund", scheme);
      });
    });
    test.describe("new cash after a return", () => {
      test.use({ privateShopFacts: ["cashReceipt"] });
      test(`new receipt amount stays blank after a partial return (${scheme})`, async ({
        page,
        privateShop,
      }) => {
        const fact = privateShop.values.cashReceipt as { tripId: string; name: string };
        await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
        const row = page.locator("li").filter({ hasText: fact.name }).filter({ visible: true });
        await openRosterDetails(row);
        const status = row.getByRole("combobox", { name: t("trips.roster.paymentStatusLabel") });
        await status.selectOption("refunded");
        await row.getByLabel(t("trips.roster.paymentRefundAmountLabel")).fill("30");
        await row.getByRole("button", { name: "Update", exact: true }).click();
        await page.waitForURL(/notice=payment/);
        await expect(status).toHaveValue("partly_refunded");
        // Capture the persisted form, not the action's transient success toast.
        await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
        await openRosterDetails(row);
        await expect(status).toHaveValue("partly_refunded");
        await status.selectOption("paid");
        await expect(row.getByLabel(t("trips.roster.paymentAmountLabel"))).toBeEmpty();
        await capture(page, "roster-cash-receipt-after-return", scheme);
      });
    });
    test.describe("external balance", () => {
      test.use({ privateShopFacts: ["mixedDeposit"] });
      test(`external balance keeps the Stripe deposit (${scheme})`, async ({
        page,
        privateShop,
      }) => {
        const fact = privateShop.values.mixedDeposit as { tripId: string; name: string };
        await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
        const row = page.locator("li").filter({ hasText: fact.name }).filter({ visible: true });
        await openRosterDetails(row);
        await expect(row.getByLabel(t("trips.roster.paymentAmountLabel"))).toBeVisible();
        await capture(page, "roster-stripe-deposit-cash-balance", scheme);
      });
    });
  });
}
