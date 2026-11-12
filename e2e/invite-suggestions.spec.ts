import { expect, signedInAsOwner, test } from "./fixtures";
import { seededTripId } from "./helpers";

signedInAsOwner();
test("reveals the remaining past divers and their invitation actions", async ({
  page,
}, testInfo) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — French Reef");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/shop/blue-mantis/trips/${id}`);
  const initial = page.getByTestId("invite-suggestions");
  await expect(initial).toBeVisible();
  const disclosure = initial.locator("+ details");
  const summary = disclosure.locator("summary");
  await expect(summary).toContainText(/and \d+ more/);
  const people = disclosure.locator("li");
  expect(await people.count()).toBeGreaterThan(0);
  await expect(people.first()).toBeHidden();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(people.first()).toBeVisible();
  await expect(people.first().getByRole("button", { name: /offer .* a seat/i })).toBeVisible();
  await summary.click();
  await expect(people.first()).toBeHidden();
  await summary.click();
  await expect(people.first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("invite-open-phone.png") });
  await page.setViewportSize({ width: 1280, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("invite-open-desktop.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/shop/blue-mantis/inbox");
  await page.goBack();
  await expect(initial).toBeVisible();
  await expect(summary).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/inbox$/);
});

test.describe("Spanish phone", () => {
  test.use({ locale: "es-ES", viewport: { width: 390, height: 844 } });
  test("opens and closes the remaining people without widening the page", async ({ page }) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — French Reef");
    await page.goto(`/shop/blue-mantis/trips/${id}`);
    const initial = page.getByTestId("invite-suggestions");
    await expect(initial).toBeVisible();
    const disclosure = initial.locator("+ details");
    const summary = disclosure.locator("summary");
    await expect(summary).toContainText(/y \d+ más/);
    await summary.click();
    await expect(disclosure.locator("li").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await summary.click();
    await expect(disclosure.locator("li").first()).toBeHidden();
  });
});
