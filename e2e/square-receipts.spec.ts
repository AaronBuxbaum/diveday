import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const t = staffTranslator("en-US");
test.use({ privateShopFacts: ["disconnectedSquareReceipt"], privateShopDemo: false });

test("deletes only a disconnected Square receipt link, keeping the paid purchase", async ({
  page,
  privateShop,
}) => {
  const fact = privateShop.values.disconnectedSquareReceipt as {
    orderId: string;
    paymentId: string;
  };
  await page.goto(`/shop/${privateShop.slug}/orders/${fact.orderId}`);
  await expect(page.getByText(fact.paymentId, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: t("integrations.square.recheck") })).toBeDisabled();
  await expect(page.getByText("Reef shirt", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: t("integrations.square.deleteLink") }).click();
  await page.waitForURL(/notice=square-deleted/);
  await expect(page.getByText(t("integrations.square.outcome.deleted"))).toBeVisible();
  await expect(page.getByText(fact.paymentId, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reef shirt", { exact: false })).toBeVisible();
  await expect(page.getByText("$100.00", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(fact.paymentId, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reef shirt", { exact: false })).toBeVisible();
});
