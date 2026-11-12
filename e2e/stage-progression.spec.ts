import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, seededTripId } from "./helpers";

signedInAsOwner();
test("the stage strip keeps repeat and backward taps available", async ({ page }, testInfo) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
  const strip = page.getByRole("region", { name: "Where the boat is" });
  await expect(strip).toBeVisible();
  await offlineCopySaved(page);
  await strip.screenshot({ path: testInfo.outputPath("stage-phone.png") });
  const underway = strip.getByRole("button", { name: "Underway" });
  const surface = strip.getByRole("button", { name: "Surface" });
  const separator = underway.locator("..").locator(":scope > span[aria-hidden=true]");
  await underway.focus();
  await expect(underway).toHaveCSS("outline-offset", "-3px");
  await expect(separator).toBeHidden();
  for (const button of [underway, surface, underway]) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 844 });
  await strip.screenshot({ path: testInfo.outputPath("stage-desktop.png") });
});
