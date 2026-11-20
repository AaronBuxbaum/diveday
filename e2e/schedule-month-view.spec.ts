import { expect, READ_ONLY, test } from "./fixtures";

/** The list is the default; the month calendar sits behind one icon button (issue #4379). */
test("the month icon swaps the day strip for a calendar and back", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("region", { name: "Month calendar" })).toHaveCount(0);
  await page.getByRole("link", { name: "Show the month calendar" }).click();
  await expect(page).toHaveURL(/view=month/);
  const calendar = page.getByRole("region", { name: "Month calendar" });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole("link").first()).toHaveAttribute("href", /^#day-/);
  await page.getByRole("link", { name: "Show the list" }).click();
  await expect(page).not.toHaveURL(/view=month/);
});
