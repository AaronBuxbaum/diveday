import { expect, test } from "./fixtures";

test("the public schedule lists seeded trips with capacity states, a calendar, and per-dive briefings", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toBeVisible();
  // Assert the count rather than visibility: a capacity badge can double-render
  // for a sub-frame during hydration, and Playwright throws strict-mode
  // violations immediately without retrying — so an unscoped `toBeVisible` here
  // flakes under load. `toHaveCount(1)` retries until the DOM settles, yet still
  // fails loudly if two trips ever genuinely show the same capacity.
  await expect(page.getByText("3 spots left")).toHaveCount(1); // 9 of 12 booked
  await expect(page.getByText("Full")).toHaveCount(1); // sold-out wreck trip
  await expect(page.getByRole("link", { name: "Schedule a trip" })).toHaveCount(0);
  await expect(page.getByLabel("Schedule overview")).toHaveCount(0);
  await expect(page.getByText(/reserve your spot/i)).toBeVisible();

  // The month calendar shows scheduled dives alongside the list.
  const calendar = page.getByRole("region", { name: "Dive schedule calendar" });
  await expect(calendar).toBeVisible();
  // The calendar defaults to the current month, so the heading's year tracks
  // whatever year the suite actually runs in — a hardcoded year here passes
  // today and fails deterministically every New Year's.
  const currentYear = new Date().getUTCFullYear();
  await expect(
    calendar.getByRole("heading", { name: new RegExp(`\\b${currentYear}\\b`) }),
  ).toBeVisible();
  // Each dive is a link into its schedule detail (labelled by start time so it
  // doesn't collide with the titled cards in the list below).
  await expect(calendar.getByRole("link", { name: /\bdive\b/ }).first()).toBeVisible();
  await expect(calendar.locator('a[href*="/schedule/"]').first()).toBeVisible();

  // A multi-dive trip's public page presents every dive briefing.
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { name: "Your two-tank plan" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Dive 1$/ })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Dive 2$/ })).toBeVisible();
  await expect(page.getByText("French Reef is the second tank")).toBeVisible();
});
