import type { Page } from "@playwright/test";
import { expect, makeActivitySafe, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

async function setUnits(page: Page, slug: string, unit: "meters" | "feet") {
  await page.goto(`/shop/${slug}/settings`);
  await openSettingsRow(page, "Units");
  await page.getByLabel("Show depths in", { exact: true }).selectOption(unit);
  await page.getByRole("button", { name: "Save units" }).click();
  await expect(page.getByText(/Units saved/)).toBeVisible();
}

async function openLog(page: Page, slug: string, tripId: string) {
  await page.goto(`/shop/${slug}/trips/${tripId}/manifest?checkpoint=after_dive_1`);
  await page.locator("summary").filter({ hasText: "Dive 1" }).click();
  return page.locator("form").filter({ hasText: "Dive 1" });
}

for (const { unit, entered, meters } of [
  { unit: "feet", entered: "60.5", meters: 18.4404 },
  { unit: "meters", entered: "20.4", meters: 20.4 },
] as const) {
  test.describe(`recorded depth in ${unit}`, () => {
    test.use({ privateShopFacts: [{ name: "executedDepth", unit, meters }] });
    test("an unrelated edit preserves fractional executed depth", async ({ page, privateShop }) => {
      const { tripId } = privateShop.values.executedDepth as { tripId: string };
      const log = await openLog(page, privateShop.slug, tripId);
      await expect(log.getByLabel(/Maximum depth/)).toHaveValue(entered);
      await log.getByLabel("Visibility", { exact: true }).fill("Good");
      await log.getByRole("button", { name: "Save dive record" }).click();
      await expect(log.getByText("Dive record saved")).toBeVisible();
      await page.reload();
      await page.locator("summary").filter({ hasText: "Dive 1" }).click();
      await expect(log.locator('input[name="maxDepthMeters"]')).toHaveValue(String(meters));
      await expect(log.getByLabel("Visibility", { exact: true })).toHaveValue("Good");
    });
  });
}

test.describe("an open depth form", () => {
  test.use({ privateShopFacts: [{ name: "executedDepth", unit: "feet", meters: null }] });
  test("keeps its unit when another page changes preferences", async ({
    page,
    privateShop,
    context,
  }) => {
    const { tripId } = privateShop.values.executedDepth as { tripId: string };
    const log = await openLog(page, privateShop.slug, tripId);
    await log.getByLabel(/Maximum depth/).fill("60");
    const settings = makeActivitySafe(await context.newPage());
    await setUnits(settings, privateShop.slug, "meters");
    await log.getByRole("button", { name: "Save dive record" }).click();
    await expect(log.getByText("Dive record saved")).toBeVisible();
    await page.reload();
    await page.locator("summary").filter({ hasText: "Dive 1" }).click();
    await expect(log.locator('input[name="maxDepthMeters"]')).toHaveValue("18.288");
    await settings.close();
  });
});
