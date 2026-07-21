import { argosScreenshot } from "@argos-ci/playwright";
import type { Page } from "@playwright/test";
import { signedInAsOwner, test } from "./fixtures";

/**
 * Visual regression coverage (Argos). Ten key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 40 screenshots per run (see ADR
 * 20260721-argos-visual-regression).
 *
 * Both viewports come from one `argosScreenshot` call via its `viewports`
 * option: Argos resizes the page, captures each, and suffixes the name with
 * ` vw-<width>`, so `landing-light` becomes `landing-light vw-390` and
 * `landing-light vw-1280`. The widths match scripts/screenshot.mjs — phone 390,
 * desktop 1280 — so the design-review PNGs and the regression baselines share
 * one definition of "phone" and "desktop".
 *
 * Screenshots are always captured; the Argos reporter in playwright.config.ts
 * only uploads when ARGOS_TOKEN is present, so the suite stays green (and
 * local runs stay offline) without an Argos account.
 */

// Phone first, then desktop — matches scripts/screenshot.mjs. Navigation and
// clicks happen at the desktop base viewport (see viewport in test.use below);
// these only resize the page for the capture itself.
const VIEWPORTS = [
  { width: 390, height: 844 }, // phone
  { width: 1280, height: 800 }, // desktop
] as const;

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
    page.getByText(/\d{1,2}\/\d{1,2}\/\d{2,4}/), // "7/21/2026"-style dates (e.g. cert expiry)
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
    viewports: [...VIEWPORTS],
    mask: dynamicText(page),
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`public surfaces render true to the design (${scheme})`, async ({ page }) => {
      await page.goto("/");
      await capture(page, "landing", scheme);

      await page.goto("/sign-in");
      await capture(page, "sign-in", scheme);

      await page.goto("/shop/blue-mantis/schedule");
      await capture(page, "schedule", scheme);

      // The seeded reef trip's public briefing: satellite map, gentle route,
      // landmarks, and the field guide — DiveDay's flagship "delight" surface.
      await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
      await page.getByTitle("Satellite map of Molasses Reef").waitFor();
      await capture(page, "site-briefing", scheme);

      await page.goto("/shop/blue-mantis/courses/open-water-diver");
      await capture(page, "course-page", scheme);
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`staff surfaces render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await capture(page, "today", scheme);

        // The roster, then one diver's full profile (certs, specialty cards,
        // contact) — the front desk's densest everyday surfaces.
        await page.goto("/shop/blue-mantis/divers");
        await capture(page, "divers", scheme);

        await page
          .getByRole("row")
          .filter({ hasText: "Priya Sharma" })
          .getByText("PS", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        await capture(page, "diver-profile", scheme);

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
