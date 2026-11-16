import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
// privateShop performs the real owner login in a fresh browser context.
test.use({ privateShopSlug: "classroom-recovery-review", privateShopFacts: ["operationsVisual"] });
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
const t = staffTranslator("en-US");
test("classroom recovery arrangements on phone and desktop (light)", async ({
  page,
  privateShop,
}) => {
  const fact = privateShop.values.operationsVisual as { sourceTripId: string };
  await page.goto(`/shop/${privateShop.slug}/trips/${fact.sourceTripId}?blowout=1`);
  await expect(
    page.getByRole("heading", { name: "Reef photography in the classroom", exact: true }),
  ).toBeVisible();
  await page.getByText(t("blowout.classroom.divers"), { exact: true }).click();
  await expect(page.getByText(t("blowout.classroom.confirmed"), { exact: true })).toBeVisible();
  await expect(page.getByText(t("blowout.classroom.prepared"), { exact: true })).toBeVisible();
  await expect(page.getByText("Shore Recovery Diver", { exact: true }).first()).toBeVisible();
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await capture(page, `classroom-recovery-${viewport.name}`, "light");
  }
});
