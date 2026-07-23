import { argosScreenshot } from "@argos-ci/playwright";
import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { signedInAsOwner, test } from "./fixtures";

/**
 * Visual regression coverage (Argos). Eighteen key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 72 screenshots per run (see ADR
 * 20260721-argos-visual-regression). Keep these counts in sync when adding a
 * surface; each `capture()` call costs 4 screenshots per CI run.
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
 *
 * Stability: these are captured full-page with nothing masked, so a
 * regression anywhere — including in a time or a date — is caught. That is
 * only safe because the clock is frozen on both sides: the server by
 * DIVEDAY_CLOCK (playwright.config.ts → src/lib/clock.ts), so the clock-anchored
 * seed and every render resolve to one fixed instant; the browser by the
 * context-fixture init script in e2e/fixtures.ts, so client-side relative time
 * ("3m ago") agrees with the server. Freeze the clock, never mask the output —
 * masking
 * hides the very pixels a regression would move, and never stabilised the
 * layout shifts (a reordered queue, a trip crossing from upcoming to sailed)
 * that a moving clock actually causes.
 *
 * `capture` also waits on `document.fonts.ready` before every screenshot.
 * The Geist fonts (next/font/google) load asynchronously; without this wait,
 * a capture can land on either side of the fallback→webfont swap and render
 * the same text with different sub-pixel antialiasing, which Argos reports
 * as a false diff (this is what produced the "flaky" schedule/today/divers
 * diffs on builds with no real change).
 */

// Phone first, then desktop — matches scripts/screenshot.mjs. Navigation and
// clicks happen at the desktop base viewport (see viewport in test.use below);
// these only resize the page for the capture itself.
const VIEWPORTS = [
  { width: 390, height: 844 }, // phone
  { width: 1280, height: 800 }, // desktop
] as const;

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  await page.evaluate(() => document.fonts.ready);
  await argosScreenshot(page, `${name}-${scheme}`, {
    fullPage: true,
    viewports: [...VIEWPORTS],
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

      // The post-trip recap: a signed-token diver page minted for the pinned
      // demo booking (src/db/seed.ts), so the marquee word-of-mouth surface has
      // a stable baseline without an in-app link to reach it.
      await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
      await page.getByRole("heading", { name: /Nice diving/ }).waitFor();
      await capture(page, "recap", scheme);

      // The migration-guides hub: one card per incumbent a shop might be
      // leaving, the entry point to the portability wedge on the marketing side.
      await page.goto("/switching");
      await page.getByRole("heading", { name: "The door swings both ways." }).waitFor();
      await capture(page, "switching-hub", scheme);

      // The "Switching from EVE" migration guide: the marketing face of the
      // portability wedge — export click-path, the shared scope table, and the
      // importer, on the market's most motivated switching pool. Represents the
      // shared guide template every live incumbent page renders.
      await page.goto("/switching/eve");
      await page.getByRole("heading", { name: "Moving your shop off EVE" }).waitFor();
      await capture(page, "switching-eve", scheme);
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

        // A diver holding a lapsed card: the expired badge renders red and the
        // card no longer counts as valid — the safety-relevant new state.
        await page.goto("/shop/blue-mantis/divers");
        await page
          .getByRole("row")
          .filter({ hasText: "Yusuf Demir" })
          .getByText("YD", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Yusuf Demir" }).waitFor();
        await capture(page, "diver-profile-expired", scheme);

        // The seeded reef trip: schedule card → Overview (what the dive is) →
        // Guests (who is attending) → Manifest (the day-of boarding + roll call).
        await page.goto("/shop/blue-mantis/schedule");
        await page
          .locator("li")
          .filter({ hasText: "Two-Tank Reef — Molasses & French" })
          .getByRole("link")
          .click();
        await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
        // The four trip surfaces share a layout that streams a skeleton while the
        // page's data loads, so every capture waits for real content — never the
        // loading fallback — before shooting.
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        await capture(page, "trip-manage", scheme);

        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Guests" })
          .click();
        await page.waitForURL(/\/guests/);
        await page.getByRole("heading", { name: /Divers/ }).waitFor();
        await capture(page, "trip-guests", scheme);

        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Manifest" })
          .click();
        await page.waitForURL(/\/manifest/);
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        await capture(page, "manifest", scheme);

        // Shop settings, where staff set the rental catalog and its prices.
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Rental prices" }).waitFor();
        await capture(page, "settings-payments", scheme);

        // The data-export surface: the "your data is yours" promise, concrete.
        await page.goto("/shop/blue-mantis/settings/export");
        await page.getByRole("heading", { name: "Data export" }).waitFor();
        await capture(page, "settings-export", scheme);

        // The import surface: the honesty table stating what does and doesn't
        // come across, before any file is chosen.
        await page.goto("/shop/blue-mantis/settings/import");
        await page.getByRole("heading", { name: "What comes across" }).waitFor();
        await capture(page, "settings-import", scheme);
      });
    });
  });
}
