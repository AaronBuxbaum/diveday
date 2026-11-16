import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
// privateShop performs the real owner login in a fresh browser context.
test.use({ privateShopSlug: "promotional-credit-review", privateShopFacts: ["operationsVisual"] });
const t = staffTranslator("en-US");
test("populated promotional trip credit on phone and desktop (light)", async ({
  page,
  privateShop,
}) => {
  const fact = privateShop.values.operationsVisual as { personId: string };
  await page.goto(`/shop/${privateShop.slug}/divers/${fact.personId}`);
  await page
    .locator("summary")
    .filter({ hasText: t("divers.tripCredit.title") })
    .click();
  await expect(page.getByText("$70.00", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: t("divers.tripCredit.apply", { amount: "$60.00" }),
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByText(t("divers.tripCredit.history"), { exact: true })).toBeVisible();
  await expect(page.getByText(t("divers.tripCredit.policy"), { exact: true })).toBeVisible();
  await expect(
    page.getByText("Next sheltered shore session", { exact: false }).first(),
  ).toBeVisible();
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await capture(page, `promotional-trip-credit-${viewport.name}`, "light");
  }
});
