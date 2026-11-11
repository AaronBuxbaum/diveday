import { expect, settleStaffHydration, test } from "./fixtures";
import { openSettingsRow, tripPathByTitle } from "./helpers";

test("executed depth keeps fractional evidence and the open form's units", async ({
  page,
  privateShop,
  context,
}, testInfo) => {
  const settings = await context.newPage();
  await settings.goto(`/shop/${privateShop.slug}/settings`);
  await settleStaffHydration(settings);
  await openSettingsRow(settings, "Units");
  await settings.getByLabel("Show depths in", { exact: true }).selectOption("feet");
  await settings.getByRole("button", { name: "Save units" }).click();
  await expect(settings.getByText(/Units saved/)).toBeVisible();

  const tripPath = await tripPathByTitle(
    page,
    privateShop.slug,
    "Two-Tank Reef — Molasses & French",
  );
  await page.goto(`${tripPath}/manifest?checkpoint=after_dive_1`);
  const summary = page.locator("summary").filter({ hasText: "Dive 1" });
  await summary.click();
  const log = page.locator("form").filter({ hasText: "Dive 1" });
  await log.getByLabel(/Maximum depth/).fill("60.5");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  await page.reload();
  await summary.click();
  await expect(log.getByLabel(/Maximum depth/)).toHaveValue("60.5");
  await log.getByLabel("Visibility", { exact: true }).fill("Clear");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  await page.reload();
  await summary.click();
  await expect(log.locator('input[name="maxDepthMeters"]')).toHaveValue("18.4404");
  await log.getByLabel(/Maximum depth/).fill("60");

  // A second session changes only presentation preferences while this edit stays open.
  await settings.goto(`/shop/${privateShop.slug}/settings`);
  await settleStaffHydration(settings);
  await openSettingsRow(settings, "Units");
  await settings.getByLabel("Show depths in", { exact: true }).selectOption("meters");
  await settings.getByRole("button", { name: "Save units" }).click();
  await expect(settings.getByText(/Units saved/)).toBeVisible();
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  await page.reload();
  await summary.click();
  await expect(log.locator('input[name="maxDepthMeters"]')).toHaveValue("18.288");
  await log.getByLabel(/Maximum depth/).fill("20.4");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  await page.reload();
  await summary.click();
  await expect(log.getByLabel(/Maximum depth/)).toHaveValue("20.4");
  await log.getByLabel("Visibility", { exact: true }).fill("Good");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  await page.reload();
  await summary.click();
  await expect(log.locator('input[name="maxDepthMeters"]')).toHaveValue("20.4");
  await log.screenshot({ path: testInfo.outputPath("executed-depth.png") });
  await settings.close();
});
