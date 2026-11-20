import { expect, READ_ONLY, test } from "./fixtures";

/** One day across every boat, reached from the Schedule views (issue #4258). */
test("the Boats view draws a day across the shop's boats", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/boats");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Next day" }).click();
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("link", { name: "Trips", exact: true })).toBeVisible();
});
