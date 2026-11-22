import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use({ privateShopSlug: "diver-credit-review", privateShopFacts: ["operationsVisual"] });
const t = diverTranslator("en-US");

test("light mode diver applies credit on an eligible booking", async ({ page, privateShop }) => {
  const fact = privateShop.values.operationsVisual as {
    creditDelivered: string;
    creditRedirect: string;
  };
  const action = t("ready.useTripCredit", { fare: "$60.00" });
  await page.goto(`/ready/${fact.creditRedirect}`);
  await expect(page.getByRole("button", { name: action })).toHaveCount(0);
  await page.goto(`/ready/${fact.creditDelivered}`);
  await expect(page.getByText(t("ready.tripCreditAvailable", { balance: "$70.00" }))).toBeVisible();
  await expect(page.getByRole("button", { name: action })).toBeVisible();
  await capture(page, "diver-trip-credit", "light");
  await Promise.all([
    page.waitForURL(/\?pay=paid/),
    page.getByRole("button", { name: action }).click(),
  ]);
  await expect(
    page.getByText(t("ready.tripCreditApplied", { amount: "$60.00", balance: "$10.00" })),
  ).toBeVisible();
});
