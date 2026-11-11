import { staffTranslator } from "../src/i18n/staff-messages";
import { formatMoneyCents } from "../src/lib/format";
import { expect, test } from "./fixtures";
import { openRosterDetails } from "./helpers";

const t = staffTranslator("en-US");

test.describe("recorded collection statements", () => {
  test.use({ privateShopFacts: ["collectionBilling"] });
  test("shows original-rate credits and native currencies without combining them", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/billing`);
    await expect(page.getByRole("heading", { name: t("billing.plan.heading") })).toBeVisible();
    await expect(
      page.getByText(formatMoneyCents(7_000, "usd", "en-US"), { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByText(formatMoneyCents(7_000, "usd", "en-US"), { exact: true })
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await expect(
      page.getByText(formatMoneyCents(5_000, "jpy", "en-US"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(t("billing.plan.refundCredit"), { exact: true })).toBeVisible();
    await expect(
      page.getByText(formatMoneyCents(150, "usd", "en-US"), { exact: true }),
    ).toHaveCount(2);
    await expect(
      page.getByText(t("billing.plan.currencyNotConfigured"), { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(t("billing.plan.refundCredit"), { exact: true })).toBeVisible();
  });
});

test.describe("Stripe deposit with external balance", () => {
  test.use({ privateShopFacts: ["mixedDeposit"] });
  test("records only the new money and preserves the online payment on repeated Update", async ({
    page,
    privateShop,
  }) => {
    const fact = privateShop.values.mixedDeposit as { tripId: string; name: string };
    await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
    const row = page.locator("li").filter({ hasText: fact.name }).filter({ visible: true });
    await openRosterDetails(row);
    await expect(
      row.getByRole("combobox", { name: t("trips.roster.paymentStatusLabel") }),
    ).toHaveValue("deposit_paid");
    await row
      .getByRole("combobox", { name: t("trips.roster.paymentStatusLabel") })
      .selectOption("paid");
    const amountBox = await row.getByLabel(t("trips.roster.paymentAmountLabel")).boundingBox();
    const methodBox = await row
      .getByRole("radio", { name: "Cash", exact: true })
      .locator("xpath=ancestor::label")
      .boundingBox();
    expect(amountBox).not.toBeNull();
    expect(methodBox).not.toBeNull();
    expect(Math.abs((amountBox?.y ?? 0) - (methodBox?.y ?? 0))).toBeLessThanOrEqual(1);
    await row.getByLabel(t("trips.roster.paymentAmountLabel")).focus();
    await page.keyboard.press("Tab");
    const cash = row.getByRole("radio", { name: "Cash", exact: true });
    await expect(cash).toBeFocused();
    expect(
      await cash
        .locator("xpath=ancestor::label")
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
    await row.getByLabel(t("trips.roster.paymentAmountLabel")).fill("70");
    await row.getByRole("radio", { name: "Cash", exact: true }).check();
    await row.getByRole("button", { name: "Update", exact: true }).click();
    await page.waitForURL(/notice=payment/);
    await expect(
      row.getByText(t("trips.roster.paymentSourceMixed"), { exact: false }),
    ).toBeVisible();
    await row.getByRole("button", { name: "Update", exact: true }).click();
    await page.waitForURL(/notice=payment/);
    await expect(
      row.getByText(t("trips.roster.paymentSourceMixed"), { exact: false }),
    ).toBeVisible();
  });
});

test.describe("external partial returns", () => {
  test.use({ privateShopFacts: ["mixedCashReceipt"] });
  test("records only cash actually returned and keeps the online deposit", async ({
    page,
    privateShop,
  }) => {
    const fact = privateShop.values.mixedCashReceipt as { tripId: string; name: string };
    await page.goto(`/shop/${privateShop.slug}/trips/${fact.tripId}`);
    const row = page.locator("li").filter({ hasText: fact.name }).filter({ visible: true });
    await openRosterDetails(row);
    const status = row.getByRole("combobox", { name: t("trips.roster.paymentStatusLabel") });
    await status.selectOption("refunded");
    await row.getByLabel(t("trips.roster.paymentRefundAmountLabel")).fill("30");
    await row.getByRole("button", { name: "Update", exact: true }).click();
    await page.waitForURL(/notice=payment/);
    await expect(status).toHaveValue("partly_refunded");
    await expect(
      row.getByText(t("trips.roster.paymentSourceMixed"), { exact: false }),
    ).toBeVisible();
    await page.reload();
    await openRosterDetails(row);
    await expect(status).toHaveValue("partly_refunded");
  });
});
