import { argosScreenshot } from "@argos-ci/playwright";
import type { Page } from "@playwright/test";
import { signedInAsOwner, test } from "./fixtures";

/**
 * Visual regression coverage (Argos). Six key surfaces × light/dark at one
 * desktop viewport — 12 screenshots per run, sized to fit Argos's free tier
 * at ~10 pushes/day (see ADR 20260721-argos-visual-regression).
 *
 * Screenshots are always captured; the Argos reporter in playwright.config.ts
 * only uploads when ARGOS_TOKEN is present, so the suite stays green (and
 * local runs stay offline) without an Argos account.
 */

/**
 * The demo seed is clock-anchored — the "sails today" departure moves to the
 * next half-hour slot every 30 minutes, and card dates track the calendar.
 * Mask time/date text so a baseline built this morning still matches a build
 * from this afternoon; layout, color, and everything else stays asserted.
 */
function dynamicText(page: Page) {
  return [
    page.getByText(/\d{1,2}:\d{2}\s*(AM|PM)?/), // clock times
    page.getByText(
      /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/,
    ), // "Jul 21"-style dates
    page.locator("time"),
    // The month calendar is calendar-driven by nature: the current-day marker
    // and which cells hold dive chips shift every day. Mask the whole region;
    // the trip list below it carries the schedule page's visual assertion.
    page.getByRole("region", { name: "Dive schedule calendar" }),
  ];
}

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  await argosScreenshot(page, `${name}-${scheme}`, {
    fullPage: true,
    mask: dynamicText(page),
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`public surfaces render true to the design (${scheme})`, async ({ page }) => {
      await page.goto("/");
      await capture(page, "landing", scheme);

      await page.goto("/shop/blue-mantis/schedule");
      await capture(page, "schedule", scheme);

      await page.goto("/shop/blue-mantis/courses/open-water-diver");
      await capture(page, "course-page", scheme);
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`staff surfaces render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await capture(page, "today", scheme);

        // The seeded reef trip: schedule card → staff manage view → manifest.
        await page.goto("/shop/blue-mantis/schedule");
        await page
          .locator("li")
          .filter({ hasText: "Two-Tank Reef — Molasses & French" })
          .getByRole("link")
          .click();
        await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
        await capture(page, "trip-manage", scheme);

        await page.getByRole("link", { name: "Boat manifest" }).click();
        await page.waitForURL(/\/manifest/);
        await capture(page, "manifest", scheme);
      });
    });
  });
}
