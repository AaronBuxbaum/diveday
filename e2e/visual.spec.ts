import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard } from "./helpers";

/**
 * Visual regression coverage. Forty-eight key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 192 screenshots per run (see
 * ADR 20260729-reg-suit-visual-regression). Keep this count in sync when
 * adding a surface; each `capture()` call costs 4 screenshots per CI run.
 * `grep -c 'await capture(page' e2e/visual.spec.ts` is the number.
 *
 * Two more come from the `print` block at the bottom: the manifest and prep
 * pages as they render for the printer. Print is its own concern, not a
 * light/dark one — the `@media print` token override collapses both schemes to
 * one black-and-white palette — so each is captured once, at a US-Letter width,
 * via `capturePrint()`. That brings the run to 194 screenshots.
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
 * Before every screenshot, `capture` runs `paintWholeDocument` (see its own
 * comment): it scrolls the document through to force the compositor to
 * rasterize every band, then waits on `document.fonts.ready`. The Geist fonts
 * (next/font/google) load asynchronously; without that wait a capture can land
 * on either side of the fallback→webfont swap and render the same text with
 * different sub-pixel antialiasing, which reads as a false diff.
 *
 * Every `capture` needs the surface to have finished rendering first — wait for
 * a heading, a known element, or (for a Client Component) a control it only
 * renders once mounted. A capture that navigates and shoots immediately
 * photographs whichever frame the suspense fallback was on, and two runs
 * disagreeing about that is what "flaky visual diff" has always turned out to
 * mean here. Waiting on a server-rendered element is not enough when the
 * interesting part is client-rendered: `course-edit` waited on a <legend> that
 * precedes its editor's mount.
 */

// Phone first, then desktop — matches scripts/screenshot.mjs. Navigation and
// clicks happen at the desktop base viewport (see viewport in test.use below);
// these only resize the page for the capture itself.
const VIEWPORTS = [
  { width: 390, height: 844 }, // phone
  { width: 1280, height: 800 }, // desktop
] as const;

/**
 * Force Chromium to paint the whole document, then settle fonts, before a
 * `fullPage` screenshot.
 *
 * A full-page capture of a tall page can come back with everything below the
 * viewport *unpainted*: `recap` at 390 was blank below its first screenful on
 * one run and fully drawn on the next, at the same 3453px height. Waiting on an
 * element does not prevent it — Playwright counts an off-screen node as
 * visible, so the wait resolves while those pixels are still unrasterized. That
 * is what made the unstable set rotate between runs (recap, manifest,
 * settings-*, course-edit, schedule-builder, site-briefing — all the tall
 * ones): each run left a different band unpainted. Scrolling the document
 * through in viewport-sized steps makes the compositor rasterize every band;
 * we then return to the top so the screenshot still starts where it always did.
 *
 * Fonts are re-awaited here, per viewport, rather than once per `capture`: a
 * resize relayouts the document and can begin a font load that the other
 * viewport never needed. `.then(() => true)` keeps the resolved value
 * serializable — `document.fonts.ready` resolves to a FontFaceSet, which
 * Playwright cannot return.
 *
 * **Images are awaited after the scroll, not before.** Forcing layout paint does
 * not decode images, and `course-page-dark` proved it: its diff was confined
 * entirely to the hero and exactly one of three gallery thumbnails, every glyph
 * around them identical — the signature of a decode that had not finished, not
 * of a code change. The scroll has to come first, because a `loading="lazy"`
 * image below the fold does not even begin fetching until it is scrolled into
 * view, so awaiting decode before the scroll would await an empty set.
 *
 * `decode()` is called on every image rather than only the ones reporting
 * `!complete`: `complete` means the bytes arrived, not that a frame is ready to
 * paint, and on an already-decoded image the promise resolves immediately.
 * Each is bounded and failure-tolerant — a broken or never-loading `src` must
 * leave a capture slightly wrong, never hang the suite. CSS background images
 * are still out of reach; nothing in the DOM exposes their decode state.
 */
/**
 * Every wait below is bounded, because `requestAnimationFrame` is not a promise
 * the page owes you.
 *
 * `settle()` used to be a bare double-`rAF` with no escape. When the renderer
 * stops producing frames — it decides the page needs no update, or a raster
 * stall swallows the frame — that callback simply never runs, and the whole
 * `page.evaluate` hangs. `page.evaluate` takes no timeout of its own, so the
 * hang runs out the *test's* budget instead: it surfaced on CI as `Test timeout
 * of 120000ms exceeded` with the stack pointing here, and it reproduces locally
 * about once in six runs of the staff captures, with or without the
 * deterministic rendering flags. It is a wait bug, not a budget that needs
 * widening (see the note on `test.setTimeout` in the staff test).
 *
 * So each frame wait races the frame against `FRAME_WAIT_MS`, and the
 * scroll-through as a whole gives up after `SCROLL_BUDGET_MS`. The bound is a
 * real trade, not a free win: a band whose frame never arrived may be captured
 * unpainted. That is the better failure — it shows up as a solid blank stripe
 * in the reg-suit diff, which triage reads at a glance, instead of a hang that
 * costs the run. `settle()` counts the waits that hit the bound and the count
 * is warned to the run log, so the condition is never silent.
 */
const FRAME_WAIT_MS = 500;
const SCROLL_BUDGET_MS = 20_000;
const FONTS_WAIT_MS = 5_000;

async function paintWholeDocument(page: Page) {
  const stalledFrames = await page.evaluate(
    async ({ frameWaitMs, scrollBudgetMs }) => {
      let stalled = 0;
      const settle = () =>
        new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          requestAnimationFrame(() => requestAnimationFrame(finish));
          setTimeout(() => {
            if (!done) stalled += 1;
            finish();
          }, frameWaitMs);
        });
      // Real timers, not the frozen clock: e2e/fixtures.ts pins only argless
      // `new Date()` / `Date.now()`, and `performance.now()` is untouched.
      const deadline = performance.now() + scrollBudgetMs;
      // Re-read scrollHeight each pass: painting a band can add height. The step
      // cap is a guard against a page that grows forever, not an expected exit.
      for (let step = 0; step < 100; step += 1) {
        const y = step * window.innerHeight;
        if (y >= document.documentElement.scrollHeight) break;
        window.scrollTo(0, y);
        await settle();
        if (performance.now() > deadline) break;
      }
      window.scrollTo(0, 0);
      await settle();

      await Promise.all(
        Array.from(document.images).map(
          (image) =>
            Promise.race([
              image.decode().catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, 5000)),
            ]) as Promise<unknown>,
        ),
      );
      // One more frame so anything decoded above is composited before the shot.
      await settle();
      return stalled;
    },
    { frameWaitMs: FRAME_WAIT_MS, scrollBudgetMs: SCROLL_BUDGET_MS },
  );
  if (stalledFrames > 0) {
    console.warn(
      `visual: ${stalledFrames} frame wait(s) hit the ${FRAME_WAIT_MS}ms bound at ${page.url()} — ` +
        "a band may be captured unpainted; check the diff for a blank stripe.",
    );
  }
  // Same reasoning as the frame waits: a webfont that never resolves must cost
  // one capture's sharpness, not the run.
  await page.evaluate(
    (ms) =>
      Promise.race([
        document.fonts.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(true), ms)),
      ]),
    FONTS_WAIT_MS,
  );
}

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  const baseViewport = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await paintWholeDocument(page);
    await page.screenshot({
      path: `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`,
      fullPage: true,
      // Finish every finite CSS animation/transition and pin infinite ones to
      // their first frame before the shot. `paintWholeDocument` above settles
      // layout, fonts, and image decode; this settles *time*. A hover lift, a
      // toast slide-in, or the schedule's skeleton shimmer caught mid-curve is
      // a different image on every run, and the diff it produces looks exactly
      // like faint antialiasing noise around the moving element.
      animations: "disabled",
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
 *
 * `globals.css`'s `@page` rule (real, unmodified for actual printing) combines
 * with `break-inside: avoid` on each row to push a row that would otherwise
 * split across a physical page onto the next one — correct for paper, but a
 * `fullPage` screenshot never draws a page boundary, so that push only shows up
 * as unexplained blank space. Which row (if any) sits near a Letter-height page
 * boundary shifts by a sub-pixel amount between renders, so the gap's size —
 * and therefore the whole image's height — was never reproducible: three local
 * runs of identical seeded content came back 816×1636, 816×1646, and 816×1667.
 * The capture only needs to verify the print color scheme and padding, not
 * pagination, so give it a page tall enough that no row is ever near a break —
 * scoped to this capture with `addStyleTag`, not to `globals.css`, so real
 * printing keeps its real Letter pagination.
 */
async function capturePrint(page: Page, name: string) {
  await page.emulateMedia({ media: "print" });
  await page.addStyleTag({ content: "@page { size: 8.5in 200in; }" });
  // After the media switch, so the bands rasterized are the print layout's.
  await paintWholeDocument(page);
  await page.screenshot({
    path: `e2e/screenshots/${name}-print.png`,
    fullPage: true,
    animations: "disabled",
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
      // 15 navigate+capture surfaces (30 screenshots) plus a real send-waiver
      // action and a real booking, all in one test — comfortably past the
      // suite's 15s default, which is sized for a single real flow, not a
      // full site tour. Without this override the run was flaky: whichever
      // capture landed on a slow font-load or cold render blew the shared
      // budget for every capture after it, and the failing step moved
      // between runs. The five switching-guide captures that used to follow
      // `recap` here have their own test below: each is a plain unauthenticated
      // page.goto with no dependency on this test's setup, so — same reasoning
      // as the "about page" split further down — there is no reason to spend
      // this test's budget on them too.
      test.setTimeout(45_000);
      await page.goto("/");
      await capture(page, "landing", scheme);

      // The other two buyer-facing sales surfaces: the product narrative
      // (readiness, dock, diver arc, honest-no scope) and the pricing page
      // with its objection FAQ. Copy changes here are product changes.
      await page.goto("/product");
      await capture(page, "product", scheme);

      await page.goto("/pricing");
      await capture(page, "pricing", scheme);

      // Where the trial actually starts: the form plus the reassurance block a
      // skeptical owner reads before typing a password.
      await page.goto("/onboard");
      await capture(page, "onboard", scheme);

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

      await page.goto("/unsubscribe/not-a-real-token");
      await capture(page, "unsubscribe-invalid", scheme);

      // Wait for a real departure card, not the loading skeleton: this capture
      // used to `goto` and shoot immediately, so it raced the schedule's
      // suspense fallback and whichever side of that race each run landed on
      // decided the baseline. Two runs catching *different* skeleton frames is
      // what produced the schedule-dark diffs on builds with no code change.
      await page.goto("/shop/blue-mantis/schedule");
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .waitFor();
      await capture(page, "schedule", scheme);

      // The embed widget's compact surface (docs ADR 20260726-schedule-embed):
      // no ShopPageHeader chrome, tighter padding — what a shop's own website
      // actually shows inside the iframe.
      // Same settle wait as the standalone schedule above, and for a sharper
      // reason: with no wait this capture sometimes shot an empty document, so
      // `fullPage` measured the viewport (844px tall) instead of the real page
      // (11802px). A baseline that is a blank viewport asserts nothing.
      await page.goto("/shop/blue-mantis/schedule?embed=1");
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link")
        .waitFor();
      await capture(page, "schedule-embed", scheme);

      // Back to the standalone (non-embed) schedule before the trip-detail
      // capture below — its links now carry embed=1 forward when the
      // schedule itself was loaded in embed mode, and the "site-briefing"
      // baseline is the standalone trip page, not the compact embed variant.
      await page.goto("/shop/blue-mantis/schedule");

      // The seeded reef trip's public briefing: satellite map, gentle route,
      // landmarks, and the field guide — DiveDay's flagship "delight" surface.
      await page
        .locator("li")
        .filter({ hasText: "Two-Tank Reef — Molasses & French" })
        .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
        .click();
      await page.getByTitle("Satellite map of Molasses Reef").waitFor();
      await capture(page, "site-briefing", scheme);

      // "Upcoming dates" is the last section the public course page streams, so
      // it is the signal that the whole document has landed — without it this
      // capture also shot a viewport-tall blank page on some runs.
      await page.goto("/shop/blue-mantis/courses/open-water-diver");
      await page.getByRole("heading", { name: "Upcoming dates" }).waitFor();
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
        .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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
      const resultNotice = diverSection.getByRole("status");
      await resultNotice.waitFor();
      const waiverHref = await resultNotice.getByRole("link").getAttribute("href");
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
        .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
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

    // Split out of the public-surfaces tour above (2026-07-30): these five were
    // the tail end of that test and the surfaces most often still unshot when a
    // slow CI runner outgrew even that test's extended budget — plain
    // unauthenticated navigations with no dependency on anything upstream, so
    // there was no reason to make them compete with recap/waiver/booking setup
    // for one shared clock.
    test(`switching guides render true to the design (${scheme})`, async ({ page }) => {
      // 5 navigate+capture surfaces (10 screenshots) — past the suite's 15s
      // default the same way the other multi-capture tests in this file are.
      test.setTimeout(30_000);

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
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`staff surfaces render true to the design (${scheme})`, async ({ page }) => {
        // 28 navigate+capture surfaces (112 screenshots) in one test — same
        // reasoning as the public-surfaces override above: the suite's 15s
        // default is sized for a single real flow, not a full site tour.
        // The budget is sized to the surface count *and* to what each capture
        // now costs — `paintWholeDocument` scrolls the whole document before
        // every shot, so a tall page is materially slower than it was. This is
        // not a knob to widen when a capture goes flaky; that is a wait bug.
        // It moved from 120s with the three money surfaces added below
        // (orders, order-detail, diver-profile-payments) — a bigger tour, not
        // a slower one, which is the only reason this number may go up.
        test.setTimeout(140_000);
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await capture(page, "today", scheme);

        // The fast walk-in flow: pick today's boat, then search or hand-enter
        // a diver — no trip page detour, no required email at the counter.
        await page.goto("/shop/blue-mantis/check-in/walk-in");
        await page.getByRole("heading", { name: "Walk-in", level: 1 }).waitFor();
        await capture(page, "check-in-walk-in", scheme);

        // The staff schedule as a builder: departures grouped by day, each row
        // carrying its own move/copy/remove controls and its crew.
        await page.goto("/shop/blue-mantis/schedule");
        await page.getByRole("heading", { name: "The board" }).waitFor();
        await capture(page, "schedule-builder", scheme);

        // The roster, then one diver's full profile (certs, specialty cards,
        // contact) — the front desk's densest everyday surfaces.
        // Wait for the roster itself, not the skeleton: same race as the public
        // schedule above, and the one that put a half-drawn loading state into
        // the divers-light baseline.
        await page.goto("/shop/blue-mantis/divers");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("searchbox", { name: "Search divers" }).waitFor();
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

        // A diver who has actually paid for something. None of the three
        // profiles above carries a single order row — verified against the
        // seed, not assumed — so `PaymentsSection` had only ever been
        // photographed empty: no payment rows, no refund controls, no status
        // pills. Talia Rosen is the seed's heaviest payer, so this is the
        // widest version of the section.
        //
        // Deliberately a fourth capture rather than a repoint of
        // `diver-profile`: Priya's profile is the baseline for the *other*
        // states on that page, and moving it would trade one blind spot for
        // another.
        //
        // What this still does NOT cover, and why: the `formatMoneyCents` line
        // in `PaymentsSection` renders only for an order with
        // `bookingId === null` — a standalone shop payment. Every seeded order
        // is generated from a booking, so that branch is unreachable from the
        // demo data and no diver profile can capture it. It stays covered by
        // `PaymentsSection.test.tsx` alone. Seeding a standalone order would
        // fix that, but it also moves the reports and orders baselines and is a
        // demo-data change, so it belongs in its own commit rather than
        // smuggled into a coverage one.
        await page.goto("/shop/blue-mantis/divers?q=Talia");
        await page
          .getByRole("row")
          .filter({ hasText: "Talia Rosen" })
          .getByText("TR", { exact: true })
          .click();
        await page.getByRole("heading", { level: 1, name: "Talia Rosen" }).waitFor();
        await page.getByRole("heading", { name: "Payments" }).waitFor();
        await capture(page, "diver-profile-payments", scheme);

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

        // The two orders surfaces — the densest money screens in the app, and
        // until now the only ones with no baseline at all. That gap was found
        // the honest way: the shop-currency change (ADR 20260731-shop-currency)
        // rewrote how every amount here is formatted, and the visual suite
        // reported nothing, because it had never looked. A surface whose whole
        // job is stating amounts is exactly where a silent pass is worthless.
        //
        // Both render the *order row's own* stored currency, not the shop's
        // current setting: a settled amount is evidence and is never
        // re-denominated by a later settings change.
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
        // The money column itself, not just the heading — the table streams in
        // and a capture taken on the header alone can bank an empty tbody.
        await page.locator("tbody tr").first().waitFor();
        await capture(page, "orders", scheme);

        // One order in full: the total, and the per-line-item amounts that a
        // literal `$` and a hardcoded `/ 100` used to compose by hand.
        await page.locator('tbody tr a[href*="/orders/"]').first().click();
        await page.getByText("Front desk").first().waitFor();
        await capture(page, "order-detail", scheme);

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
        // Wait on the panel's own button, not the page's <h1>: the panels are
        // Client Components, and per this file's rule a server-rendered
        // heading resolves before the interesting part has mounted.
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await capture(page, "settings-calendar", scheme);

        // The courses catalog: the eye visibility toggle beside the new link
        // icon that jumps to a course's public preview page.
        await page.goto("/shop/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "courses-list", scheme);

        // A course's edit page: the Day by day section's real per-day controls
        // (start/end time, time note, item list) replacing the old textarea.
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        // "Day by day" is a server-rendered <legend>, so it is on screen before
        // DayByDayEditor (a Client Component) mounts — waiting on it let the
        // capture land mid-mount. Wait for a control the editor itself renders.
        await page.getByText("Day by day").waitFor();
        await page.getByRole("button", { name: "Add item" }).first().waitFor();
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

        // The waiver: two tabs (task 155) — Template is the release editor;
        // Signatures is the signed-record evidence audit, paginated
        // (`listWaiverIntegrityAudit`, `WAIVER_INTEGRITY_PAGE_SIZE`) so the
        // demo shop's 150+ signed records render as one page with a "Show
        // more records" link rather than a silent truncation notice.
        await page.goto("/shop/blue-mantis/waivers");
        await page.getByRole("heading", { level: 1, name: "Waiver template" }).waitFor();
        await capture(page, "staff-waivers", scheme);

        await page
          .getByRole("navigation", { name: "Waiver sections" })
          .getByRole("link", { name: "Signatures" })
          .click();
        await page.waitForURL(/\/waivers\/signatures/);
        await page.getByRole("heading", { level: 1, name: "Signatures" }).waitFor();
        await page.getByRole("link", { name: "Show more records" }).waitFor();
        await capture(page, "staff-waivers-signatures", scheme);

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
            .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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

      // H-08: a site deeper than a diver's certification trains for. Warning
      // tone and *outside* the red blocker list, because it never blocks — an
      // instructor may be keeping that diver shallower on purpose. Nothing in
      // the seed reaches this state (every seeded site sits within its divers'
      // ceilings), so the depth is raised for the capture and put back after,
      // matching the nitrox pattern above. Its own test so the mutation is
      // contained and reverted regardless of pass/fail.
      test(`the roster's depth warning renders true to the design (${scheme})`, async ({
        page,
      }) => {
        const setDepth = async (meters: string) => {
          await page.goto("/shop/blue-mantis/dive-sites");
          await page.getByRole("link", { name: "Molasses Reef" }).first().click();
          await page.waitForURL(/\/dive-sites\//);
          // The seeded briefing's photo URLs can't be re-ingested from the e2e
          // sandbox and would bounce the save to ?error=images.
          await page.getByLabel(/Site photo URLs/).fill("");
          await page.getByLabel(/Maximum depth/).fill(meters);
          await page.getByRole("button", { name: "Save briefing" }).click();
          await page.getByText("Site briefing saved.").waitFor();
        };
        try {
          await setDepth("32");
          await page.goto("/shop/blue-mantis/schedule");
          await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
          await page
            .getByRole("navigation", { name: "Trip" })
            .getByRole("link", { name: "Guests" })
            .click();
          await page.waitForURL(/\/guests/);
          await page
            .getByText(/deeper than the/)
            .first()
            .waitFor();
          await capture(page, "trip-guests-depth-warning", scheme);
        } finally {
          await setDepth("12");
        }
      });

      // Land-then-undo (docs/design/principles.md §7): deleting a private
      // staff note is a purely reversible edit, so it lands immediately
      // behind a toast instead of a blocking confirm. Its own test so the
      // roster note this adds and removes doesn't leak into another
      // surface's capture.
      test(`the roster's note-delete undo toast renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/schedule");
        await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Guests" })
          .click();
        await page.waitForURL(/\/guests/);
        const row = page.locator("#roster li").first();
        await row.getByText(/Private staff notes/).click();
        await row
          .getByLabel("Add a note only staff can see")
          .fill("Visual regression seed note for the undo toast.");
        await row.getByRole("button", { name: "Add private note" }).click();
        await page.getByText("Private staff note added.").waitFor();

        await row.getByText(/Private staff notes/).click();
        await row.getByRole("button", { name: "Delete" }).click();
        await page.getByText("Private note deleted.").waitFor();
        await capture(page, "trip-guests-note-undo", scheme);
      });
    });

    // The seeded demo shop's Today queue never runs dry, so the shared
    // `EmptyState` card TodayQueue now renders when nothing needs attention
    // (docs/design/principles.md, terminal-vs-section empty states) has no
    // other baseline. A freshly onboarded shop is the real "empty queue"
    // scenario — same flow as e2e/onboard.spec.ts's first-run checklist test.
    test(`a freshly onboarded shop's Today tab renders true to the design (${scheme})`, async ({
      page,
    }) => {
      const unique = `today-empty-${Date.now()}`;
      await page.goto("/onboard");
      await page.locator('input[name="shopName"]').fill("Fresh Shop E2E");
      await page.locator('input[name="shopSlug"]').fill(unique);
      await page.locator('input[name="ownerName"]').fill("Nour Haddad");
      await page.locator('input[name="ownerEmail"]').fill(`${unique}@example.com`);
      await page.locator('input[name="ownerPassword"]').fill("trial-pass-123");
      await page.getByRole("button", { name: "Create shop & start trial" }).click();
      await page.waitForURL(new RegExp(`/shop/${unique}$`));
      await page.getByRole("heading", { name: "Get your shop ready" }).waitFor();
      await page.getByRole("heading", { name: "Nothing is waiting on you" }).waitFor();
      await capture(page, "today-empty", scheme);
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
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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
