import { expect, test } from "./fixtures";
import { e2eNow } from "./helpers";
import { capture } from "./visual-capture";

test("the public schedule lists seeded trips with capacity states, a calendar, and per-dive briefings", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  // Scoped to the departure's own card heading: the reviews section below the
  // list quotes trip titles too, so a bare text match finds two things.
  await expect(
    page.getByRole("heading", { level: 2, name: "Two-Tank Reef — Molasses & French" }),
  ).toBeVisible();
  // Assert the count rather than visibility: a capacity badge can double-render
  // for a sub-frame during hydration, and Playwright throws strict-mode
  // violations immediately without retrying — so an unscoped `toBeVisible` here
  // flakes under load. `toHaveCount(1)` retries until the DOM settles, yet still
  // fails loudly if two trips ever genuinely show the same capacity.
  await expect(page.getByText("3 spots left")).toHaveCount(1); // 9 of 12 booked
  await expect(page.getByText("Full")).toHaveCount(1); // sold-out wreck trip
  await expect(page.getByRole("link", { name: "Full trip form" })).toHaveCount(0);
  await expect(page.getByLabel("Schedule overview")).toHaveCount(0);
  await expect(page.getByText(/reserve your spot/i)).toBeVisible();

  // The month calendar shows scheduled dives alongside the list.
  const calendar = page.getByRole("region", { name: "Dive schedule calendar" });
  await expect(calendar).toBeVisible();
  // The calendar defaults to the current month, and the server clock is frozen
  // (E2E_FROZEN_CLOCK), so the heading's year is whatever year that instant
  // falls in — read it from the same source rather than the real wall clock,
  // which would diverge once real time passes the frozen year.
  const currentYear = e2eNow().getUTCFullYear();
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

// Visual regression captures for this file's surfaces (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`schedule surfaces render true to the design (${scheme})`, async ({ page }) => {
      test.setTimeout(20_000);
      // Wait for a real departure card, not the loading skeleton: a capture
      // that navigates and shoots immediately races the schedule's suspense
      // fallback, and two runs catching different skeleton frames is what
      // used to produce schedule-dark diffs with no code change.
      await page.goto("/shop/blue-mantis/schedule");
      await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).waitFor();
      await capture(page, "schedule", scheme);

      // The seeded reef trip's public briefing: satellite map, gentle route,
      // landmarks, and the field guide — DiveDay's flagship "delight" surface.
      await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
      await page.getByTitle("Satellite map of Molasses Reef").waitFor();
      await capture(page, "site-briefing", scheme);
    });
  });
}
