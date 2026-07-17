import { expect, test } from "@playwright/test";

test("schedule lists seeded upcoming trips with capacity states", async ({ page }) => {
  await page.goto("/trips");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toBeVisible();
  await expect(page.getByText("3 spots left")).toBeVisible(); // 9 of 12 booked
  await expect(page.getByText("Full")).toBeVisible(); // sold-out wreck trip
});

test("home page links to the schedule", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See the demo schedule" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
});
