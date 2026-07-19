import { expect, test } from "./fixtures";

test("schedule lists seeded upcoming trips with capacity states", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toBeVisible();
  await expect(page.getByText("3 spots left")).toBeVisible(); // 9 of 12 booked
  await expect(page.getByText("Full")).toBeVisible(); // sold-out wreck trip
  await expect(page.getByRole("link", { name: "Schedule a trip" })).toHaveCount(0);
  await expect(page.getByLabel("Schedule snapshot")).toHaveCount(0);
  await expect(page.getByText(/reserve your spot/i)).toBeVisible();
});
