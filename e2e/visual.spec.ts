import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard } from "./helpers";

/**
 * Visual regression coverage. Forty-seven key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 188 screenshots per run (see
 * ADR 20260729-reg-suit-visual-regression). Keep this count in sync when
 * adding a surface; each `capture()` call costs 4 screenshots per CI run.
 *
 * Two more come from the `print` block at the bottom: the manifest and prep
 * pages as they render for the printer. Print is its own concern, not a
 * light/dark one — the `@media print` token override collapses both schemes to
 * one black-and-white palette — so each is captured once, at a US-Letter width,
 * via `capturePrint()`. That brings the run to 190 screenshots.
 *
 * Nothing here asserts. `capture()` writes raw `page.screenshot()` PNGs into
 * `e2e/screenshots/` (gitignored); `reg-suit` diffs them against the baseline
 * for this branch's parent commit, pulled from S3, and publishes the run
 * (docs ADR 20260729-reg-suit-visual-regression). That is why a "visual
 * failure" never surfaces as a failed Playwright test — it surfaces as a diff
 * in the reg-suit report, and the `visual-triage` skill is how you read it.
 *
 * `capture()` loops over both viewports itself, resizing the page for each and
 * restoring the base viewport afterward, so `landing-light` becomes
 * `landing-light-vw-390.png` and `landing-light-vw-1280.png`. The widths match
 * scripts/screenshot.mjs — phone 390, desktop 1280 — so the design-review PNGs
 * and the regression baselines share one definition of "phone" and "desktop".
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
 * the same text with different sub-pixel antialiasing, which reads as a false
 * diff (this is what produced the "flaky" schedule/today/divers diffs on
 * builds with no real change).
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
  const baseViewport = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`,
      fullPage: true,
    });
  }
  // capture() runs mid-flow (navigation and clicks continue after it), so
  // restore the base viewport the test was using before resizing for each
  // capture above — matching what the old Argos `viewports` option did.
  if (baseViewport) await page.setViewportSize(baseViewport);
}

/**
 * Capture a surface as it renders for the printer. Emulating `print` media
 * applies the whole `@media print` treatment — monochrome tokens, page
 * padding, `print:hidden` chrome removed — so the baseline is the document a
 * shop actually prints, not the interactive page. One shot at the current
 * (Letter-width) viewport: print output is scheme- and viewport-independent, so
 * the light/dark × phone/desktop matrix the on-screen `capture` runs would be
 * four identical copies here. `@page` margins never show in a screenshot; the
 * padding visible in the baseline is the container's own (`print:px-*`), the
 * gutter that survives a "None margins" print dialog.
 */
async function capturePrint(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({
    path: `e2e/screenshots/${name}-print.png`,
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`public surfaces render true to the design (${scheme})`, async ({
      page,
      browser,
      ownerStorageState,
      request,
    }) => {
      // 19 navigate+capture surfaces (38 screenshots) plus a real send-waiver
      // action and a real booking, all in one test — comfortably past the
      // suite's 15s default, which is sized for a single real flow, not a
      // full site tour. Without this override the run was flaky: whichever
      // capture landed on a slow font-load or cold render blew the shared
      // budget for every capture after it, and the failing step moved
      // between runs.
      test.setTimeout(60_000);
      await page.goto("/");
      await capture(page, "landing", scheme);

      // The other two buyer-facing sales surfaces: the product narrative
      // (readiness, dock, diver arc, honest-no scope) and the pricing page
      // with its objection FAQ. Copy changes here are product changes.
      await page.goto("/product");
      await capture(page, "product", scheme);

      await page.goto("/pricing");
      await capture(page, "pricing", scheme);

      await page.goto("/sign-in");
      await capture(page, "sign-in", scheme);

      await page.goto("/forgot-password");
      await capture(page, "forgot-password", scheme);

      // The token pages' one always-reachable state: an unrecognized token
      // never renders anything but this same closed notice (no live token to
      // capture the confirm/reset form with — see e2e/account-lifecycle.spec.ts).
      await page.goto("/verify/not-a-real-token");
      await capture(page, "verify-invalid", scheme);

      await page.goto("/reset-password/not-a-real-token");
      await capture(page, "reset-password-invalid", scheme);

      await page.goto("/shop/blue-mantis/schedule");
      await capture(page, "schedule", scheme);

      // The embed widget's compact surface (docs ADR 20260726-schedule-embed):
      // no ShopPageHeader chrome, tighter padding — what a shop's own website
      // actually shows inside the iframe.
      await page.goto("/shop/blue-mantis/schedule?embed=1");
      await capture(page, "schedule-embed", scheme);

      // Back to the standalone (non-embed) schedule before the trip-detail
      // capture below — its links now carry embed=1 forward when the
      // schedule itself was loaded in embed mode, and the "site-briefing"
      // baseline is the standalone trip page, not the compact embed variant.
      await page.goto("/shop/blue-mantis/schedule");

      // The seeded reef trip's public briefing: satellite map, gentle route,
      // landmarks, and the field guide — DiveDay's flagship "delight" surface.
      await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
      await page.getByTitle("Satellite map of Molasses Reef").waitFor();
      await capture(page, "site-briefing", scheme);

      await page.goto("/shop/blue-mantis/courses/open-water-diver");
      await capture(page, "course-page", scheme);

      // Set a review link on a disposable staff context (same CR-019 pattern
      // as the waiver/booking setup below) so the recap capture shows the
      // "Leave a review" section — a new surface from docs ADR
      // 20260726-post-trip-review-request — without signing the public
      // `page` itself in.
      const reviewSettingsContext = await browser.newContext({ storageState: ownerStorageState });
      const reviewSettingsPage = await reviewSettingsContext.newPage();
      await reviewSettingsPage.goto("/shop/blue-mantis/settings");
      await reviewSettingsPage
        .getByLabel("Review link")
        .fill("https://g.page/r/blue-mantis/review");
      await reviewSettingsPage.getByRole("button", { name: "Save review link" }).click();
      await reviewSettingsPage.getByText("Review link saved.").waitFor();
      await reviewSettingsContext.close();

      // The post-trip recap: a signed-token diver page minted for the pinned
      // demo booking (src/db/seed.ts), so the marquee word-of-mouth surface has
      // a stable baseline without an in-app link to reach it. The tip section
      // (docs ADR 20260726-post-trip-tipping) needs a connected,
      // charges-enabled Stripe account — `canAcceptPayments` is a pure DB
      // check, independent of whether STRIPE_SECRET_KEY is set — so
      // /api/test/seed-stripe-account marks the demo shop connected without
      // ever calling Stripe, purely to render the surface for this capture.
      // The actual checkout button stays inert (no STRIPE_SECRET_KEY in this
      // fleet), the same reason no capture here exercises a real charge.
      await request.post("/api/test/seed-stripe-account");
      await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
      await page.getByRole("heading", { name: /Nice diving/ }).waitFor();
      await page.getByRole("heading", { name: "Tip your crew" }).waitFor();
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

      // The non-incumbent switching guide: shops coming from a spreadsheet — the
      // market's largest under-served pool. Its own layout (columns-that-matter,
      // the downloadable template, the free-import offer) around the same shared
      // honesty table every guide renders.
      await page.goto("/switching/spreadsheet");
      await page.getByRole("heading", { name: "The spreadsheet got you this far." }).waitFor();
      await capture(page, "switching-spreadsheet", scheme);

      // The FareHarbor guide: the coexist-led variant of the template, for a
      // booking channel a shop keeps rather than a records system it leaves —
      // the "keep it, or leave it" section (run-the-day cards + the leave path)
      // that no other guide renders.
      await page.goto("/switching/fareharbor");
      await page
        .getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." })
        .waitFor();
      await capture(page, "switching-fareharbor", scheme);

      // The Rezdy guide: the second booking-channel guide, same coexist template
      // with its own copy (a monthly-plus-per-booking model). Baselined so its
      // page — and the extra hub card it adds — stay pixel-stable.
      await page.goto("/switching/rezdy");
      await page
        .getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." })
        .waitFor();
      await capture(page, "switching-rezdy", scheme);

      // Two more safety-critical bearer-token pages, done last so minting
      // them (a real send-waiver action, a real booking) never changes the
      // seed-derived counts the captures above depend on (CR-019). Setup
      // uses a disposable staff context — a saved session, not a live
      // sign-in — so `page` itself stays the same unauthenticated visitor
      // throughout, exactly as a real diver reaches these links.
      const staffContext = await browser.newContext({ storageState: ownerStorageState });
      const staffPage = await staffContext.newPage();
      await staffPage.goto("/shop/blue-mantis/schedule");
      await staffPage
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .click();
      await staffPage.waitForURL(/\/shop\/blue-mantis\/trips\//);
      await staffPage
        .getByRole("navigation", { name: "Trip" })
        .getByRole("link", { name: "Guests" })
        .click();
      await staffPage.waitForURL(/\/guests/);
      const diverSection = staffPage
        .locator("section")
        .filter({ has: staffPage.getByRole("heading", { name: /^Divers/ }) });
      await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
      await staffPage.getByRole("heading", { name: "Private waiver link ready" }).waitFor();
      const waiverHref = await staffPage
        .getByRole("link", { name: "Open waiver link" })
        .getAttribute("href");
      await staffContext.close();

      // Active (unsigned) waiver — the safety-critical form itself, before any
      // signature or medical answer is entered.
      await page.goto(waiverHref ?? "/");
      await page.getByRole("heading", { name: "A quick step before the dock" }).waitFor();
      await capture(page, "waiver-active", scheme);

      // A fresh visitor booking the same trip hands back a readiness link —
      // the pre-trip checklist a diver actually uses on the way to the dock.
      await page.goto("/shop/blue-mantis/schedule");
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .click();
      await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
      await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
      await page
        .getByLabel("Email", { exact: true })
        .fill(`visual-regression-${scheme}@example.com`);
      await page.getByRole("button", { name: /^Book/ }).click();
      await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
      const readinessHref = await page
        .getByRole("link", { name: /readiness page/ })
        .getAttribute("href");
      await page.goto(readinessHref ?? "/");
      await page.getByRole("heading", { name: "Your pre-trip checklist" }).waitFor();
      // This is a fresh unpaid booking, so the "Need to change your plans?"
      // reschedule/cancel section (docs ADR 20260727-diver-self-service-cancel)
      // renders too — no separate capture needed, it's part of this same
      // full-page screenshot.
      await capture(page, "readiness", scheme);
    });

    // Its own test rather than another stop on the public-surfaces tour: that
    // one already carries a dozen captures against the global 15s ceiling, and
    // a trust page whose baseline is skipped because a long test ran out of
    // budget is the one baseline you'd most want.
    test(`the about page renders true to the design (${scheme})`, async ({ page }) => {
      await page.goto("/about");
      await capture(page, "about", scheme);
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`staff surfaces render true to the design (${scheme})`, async ({ page }) => {
        // 26 navigate+capture surfaces (104 screenshots) in one test — same
        // reasoning as the public-surfaces override above: the suite's 15s
        // default is sized for a single real flow, not a full site tour.
        // The budget is sized to the surface count, so it moves when the count
        // does; this is not a knob to widen when a capture goes flaky.
        test.setTimeout(120_000);
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await capture(page, "today", scheme);

        // The staff schedule as a builder: departures grouped by day, each row
        // carrying its own move/copy/remove controls and its crew.
        await page.goto("/shop/blue-mantis/schedule");
        await page.getByRole("heading", { name: "The board" }).waitFor();
        await capture(page, "schedule-builder", scheme);

        // The roster, then one diver's full profile (certs, specialty cards,
        // contact) — the front desk's densest everyday surfaces.
        await page.goto("/shop/blue-mantis/divers");
        await capture(page, "divers", scheme);

        // Found by search, not by scrolling: the demo shop now has enough
        // divers to page the roster, so nobody is reliably on the first page.
        await page.goto("/shop/blue-mantis/divers?q=Priya");
        await page
          .getByRole("row")
          .filter({ hasText: "Priya Sharma" })
          .getByText("PS", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        await capture(page, "diver-profile", scheme);

        // A diver holding a card past its shop refresher-due date: the
        // "refresher due" badge renders red and the card no longer counts as
        // valid — the safety-relevant state (H-08: cards don't expire).
        await page.goto("/shop/blue-mantis/divers?q=Yusuf");
        await page
          .getByRole("row")
          .filter({ hasText: "Yusuf Demir" })
          .getByText("YD", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Yusuf Demir" }).waitFor();
        await capture(page, "diver-profile-expired", scheme);

        // The migrated diver, and every surface that has to say so. Her level
        // card reads verified with an "imported" provenance chip and a one-tap
        // "Confirm card" nudge (ADR 20260724-import-verified-cards), and her
        // shop history carries the visits that came across from the old system
        // (ADR 20260725-import-prior-visits) — imported-marked, unlinked, with a
        // cancelled booking struck through so it can't be read as a dive. This
        // page is where a spreadsheet cell either looks like evidence or looks
        // like what it is, so it is worth a baseline in both schemes.
        await page.goto("/shop/blue-mantis/divers?q=Hana");
        await page
          .getByRole("row")
          .filter({ hasText: "Hana Kobayashi" })
          .getByText("HK", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Hana Kobayashi" }).waitFor();
        await capture(page, "diver-profile-imported", scheme);

        // The seeded reef trip: schedule card → Overview (what the dive is) →
        // Guests (who is attending) → Manifest (the day-of boarding + roll call).
        await page.goto("/shop/blue-mantis/schedule");
        await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
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
        // The offline safety copy now saves itself in the background on
        // mount; wait for that to settle (the offline-roll-call link only
        // renders once saved) so the capture isn't racing that async write.
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        await capture(page, "manifest", scheme);

        // The morning packing list — tanks, then rental kit. Blue Mantis fills
        // nitrox, so the Tanks tile grid is at its full Total/Air/Nitrox width;
        // the collapsed single-tile layout for a shop that doesn't is its own
        // dedicated test below (toggling the shared catalog here would leak
        // into every capture after this one in the same test).
        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Prep" })
          .click();
        await page.waitForURL(/\/prep/);
        await page.getByRole("heading", { name: "Tanks" }).waitFor();
        await capture(page, "prep", scheme);

        // The offline fallback a captain lands on after a failed reload with
        // no snapshot saved — the entire safety surface in that moment, so it
        // gets its own baseline rather than relying on the roll-call text
        // assertion in e2e/manifest.spec.ts to catch a styling regression.
        // The manifest visit just above auto-saves a device copy, so clear it
        // first to reproduce the truly-empty state (e.g. storage eviction).
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];

        // The offline shell's list view — every trip currently saved on this
        // device, reachable at dive.day root as well as `/offline-manifest`
        // directly (see ADR 20260726-shopwide-offline-manifest-priming). The
        // manifest visit above already auto-saved this trip, so capture the
        // populated list before the IndexedDB clear below.
        await page.goto("/offline-manifest");
        await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
        await capture(page, "offline-manifest-list", scheme);

        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase("diveday-offline-manifests");
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error ?? new Error("failed to clear IndexedDB"));
            }),
        );
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Nothing saved on this phone yet" }).waitFor();
        await capture(page, "offline-manifest-empty", scheme);

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

        // The embed settings page (docs ADR 20260726-schedule-embed). This
        // fleet runs `next start` against a loopback origin with no APP_HOST,
        // and publicAppUrl() refuses a loopback origin in production
        // (src/lib/notifications/index.ts checkPublicHost) — so this baseline
        // is necessarily the "hosting isn't configured" state, not the
        // SnippetField/generated-snippet state a real deploy shows. Still a
        // real, reachable page worth a regression baseline; just not the
        // whole surface.
        await page.goto("/shop/blue-mantis/settings/embed");
        await page.getByRole("heading", { name: "Website embed" }).waitFor();
        await capture(page, "settings-embed", scheme);

        // The team surface: inviting staff and the current roster, each card's
        // Enable/Disable/Delete immediate-action buttons and its role
        // checkboxes batched into the page's single "Save changes".
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        await capture(page, "settings-team", scheme);

        // Calendar subscriptions, in the un-subscribed state: both scopes
        // offered to an owner, neither yet minted. Deliberately not the
        // just-minted state — that panel shows a live feed token, which is
        // different on every run and would never match a baseline.
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("heading", { level: 1, name: "Calendar subscriptions" }).waitFor();
        await capture(page, "settings-calendar", scheme);

        // The courses catalog: the eye visibility toggle beside the new link
        // icon that jumps to a course's public preview page.
        await page.goto("/shop/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "courses-list", scheme);

        // A course's edit page: the Day by day section's real per-day controls
        // (start/end time, time note, item list) replacing the old textarea.
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        await page.getByText("Day by day").waitFor();
        await capture(page, "course-edit", scheme);

        // The path builder: the ordered rungs with their move/remove controls,
        // the picker, and the live diver-facing preview — the catalog's one
        // genuinely interactive surface.
        await page.goto("/shop/blue-mantis/courses/paths");
        await page.getByRole("heading", { level: 1, name: "Certification paths" }).waitFor();
        await capture(page, "course-paths", scheme);
        await page.getByRole("link", { name: "From first breath to Rescue Diver" }).first().click();
        await page.getByRole("region", { name: "Path preview" }).waitFor();
        await capture(page, "course-path-builder", scheme);

        // Owner reporting: "how's my month" over the seeded back-fill — the KPI
        // row and the per-trip breakdown that answer the buyer's revenue question.
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("heading", { level: 1, name: "How's your month" }).waitFor();
        await capture(page, "reports", scheme);

        // The moderation queue: published reviews, and the "waiting on you"
        // card a written review sits in until staff release it
        // (docs ADR 20260729-verified-diver-reviews).
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "What divers said" }).waitFor();
        await capture(page, "staff-reviews", scheme);

        // Shop-wide discount codes: the create form plus the seeded codes with
        // their windows and redemption counts
        // (docs ADR 20260729-shop-promo-codes).
        await page.goto("/shop/blue-mantis/promos");
        await page.getByRole("heading", { level: 1, name: "Discounts a diver can type" }).waitFor();
        await capture(page, "staff-promos", scheme);
      });

      // H-13: the roster's identity gate gets its own test so its capture never
      // crowds the long staff-surfaces test's per-test time budget. A Night-trip
      // seat booked through a shared inbox under a name that doesn't match the
      // person on file shows the fail-closed "Confirm identity" affordance and
      // blocker until staff vouch for it — a safety-critical state worth a baseline.
      test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Guests" })
          .click();
        await page.waitForURL(/\/guests/);
        await page.getByText("Identity unconfirmed").first().waitFor();
        await capture(page, "trip-guests-identity", scheme);
      });

      // A shop that doesn't fill nitrox (or a trip with no live request left
      // on it once nitrox is off) sees Total and Air collapse into a single
      // tile — there's nothing for a second number to distinguish. Its own
      // test, not the sequential staff-surfaces one above, so toggling the
      // shared demo shop's rental catalog for its duration is contained and
      // reverted regardless of pass/fail, matching the pattern in
      // e2e/nitrox.spec.ts.
      test(`the prep page's tank tile collapses with nitrox off (${scheme})`, async ({ page }) => {
        try {
          await page.goto("/shop/blue-mantis/settings");
          await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
          await page.getByRole("button", { name: "Save rental catalog" }).click();
          await page.getByText("Rental catalog saved.").waitFor();

          await page.goto("/shop/blue-mantis/schedule");
          await page
            .locator("li")
            .filter({ hasText: "Two-Tank Reef — Molasses & French" })
            .getByRole("link")
            .click();
          await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
          await page
            .getByRole("navigation", { name: "Trip" })
            .getByRole("link", { name: "Prep" })
            .click();
          await page.waitForURL(/\/prep/);
          await page.getByRole("heading", { name: "Tanks" }).waitFor();
          await capture(page, "prep-no-nitrox", scheme);
        } finally {
          await page.goto("/shop/blue-mantis/settings");
          await page.getByRole("checkbox", { name: "Nitrox fills" }).check();
          await page.getByRole("button", { name: "Save rental catalog" }).click();
          await page.getByText("Rental catalog saved.").waitFor();
        }
      });
    });
  });
}

/**
 * Print / Save-as-PDF surfaces. The manifest and the prep list are the two
 * pages staff physically print for the dock, and print gets a dedicated
 * rendering (globals.css `@media print`): monochrome, so a shop's black-and-
 * white printer isn't asked for muddy color, and padded, so content doesn't
 * slam into the paper edge. The interactive baselines above never exercise
 * that path. This block lives outside the light/dark loop on purpose — print
 * is scheme-independent — and runs at a US-Letter-ish width so the baseline
 * reflects paper rather than a 1280px browser window.
 */
test.describe("print", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 816, height: 1056 } });

  test("dock print surfaces render monochrome and padded", async ({ page }) => {
    // Reach the seeded reef trip the way staff do, then print its two dock
    // surfaces. Navigating by link keeps this off any hard-coded trip id.
    await page.goto("/shop/blue-mantis/schedule");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link")
      .click();
    await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
    const tripPath = new URL(page.url()).pathname;

    await page.goto(`${tripPath}/manifest`);
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await capturePrint(page, "manifest");

    await page.goto(`${tripPath}/prep`);
    await page.getByRole("heading", { name: "Tanks" }).waitFor();
    await capturePrint(page, "prep");
  });
});
