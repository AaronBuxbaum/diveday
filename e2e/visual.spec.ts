import type { Browser, Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { OFFLINE_MANIFEST_PENDING_GRACE_MS } from "../src/lib/offline-manifest-store";
import { OFFLINE_MANIFEST_RECORD_VERSION } from "../src/lib/offline-manifests";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  daysFromNow,
  openSettingsRow,
  openTripFromBoard,
  openTripTab,
  seededTripId,
} from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * Visual regression coverage. Ninety-eight key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 392 screenshots per run (see
 * ADR 20260729-reg-suit-visual-regression). Keep this count in sync when
 * adding a surface; each `capture()` call costs 4 screenshots per CI run.
 * `grep -c 'await capture(page,' e2e/visual.spec.ts` is the number — the prose
 * has drifted from it before (it read 48 while the grep said 56, 71 while the
 * grep said 72, and 83 while the grep said 93), so trust the grep and correct
 * the prose. The trailing comma in that pattern is load-bearing: without it the
 * grep also matches this very sentence and reads one high, which is how the
 * "correct the prose" instruction above ended up chasing a number that was
 * never right.
 *
 * Three more come from the `print` block at the bottom: the manifest, prep,
 * and incident-export pages as they render for the printer. Print is its own
 * concern, not a light/dark one — the `@media print` token override collapses
 * both schemes to one black-and-white palette — so each is captured once, at a
 * US-Letter width, via `capturePrint()`. That brings the run to 383
 * screenshots.
 *
 * ## One surface, one `test()`
 *
 * **This file used to be a dozen tests, each touring twenty-odd surfaces.**
 * Playwright stops a test at its first failed assertion, and every capture site
 * here is preceded by one — a `waitFor` on the heading or control that proves
 * the surface actually rendered. So a single renamed heading in the eleventh
 * surface of a tour silently took the seven after it with it: those PNGs were
 * never shot, reg-suit reported them as *deleted* items rather than diffs, and
 * a reviewer fixed one wait, pushed, and discovered the next one serially
 * (TEST-5, lens finding TEST-L1..L4 in
 * docs/product/archive/comprehensive-review-20260802.md).
 *
 * So the rule is now: **one surface, one `test()`.** A surface that breaks
 * loses exactly its own four PNGs, every sibling is still shot in the same run,
 * and the reg-suit report shows the whole blast radius at once. The handful of
 * groups left are the ones where a second test could not reproduce the state
 * without re-running the same one-shot setup *and* changing what the baseline
 * shows — each says so at its own site.
 *
 * The split is also what retires the 90-second aggregate ceilings. A test that
 * shoots one surface gets `SURFACE_TIMEOUT_MS` (below), so a genuine hang
 * surfaces in thirty seconds instead of ninety; a test that runs a real flow
 * first raises its own budget, and says what it is paying for.
 *
 * Every capture name is load-bearing and **must never change**: the reg-suit
 * baseline is keyed by image name (`<surface>-<scheme>-vw-<width>.png`) in S3,
 * so renaming a capture orphans its baseline and the surface silently reads as
 * "new item, nothing to compare". Move a capture between tests freely; renaming
 * one is a deliberate act that throws away its history.
 *
 * Nothing here asserts *about pixels*. `capture()` writes raw
 * `page.screenshot()` PNGs into `e2e/screenshots/` (gitignored); `reg-suit`
 * diffs them against the baseline for this branch's parent commit, pulled from
 * S3, and publishes the run (docs ADR 20260729-reg-suit-visual-regression).
 * That is why a "visual failure" never surfaces as a failed Playwright test —
 * it surfaces as a diff in the reg-suit report, and the `visual-triage` skill
 * is how you read it. A *failed* test here means the surface could not be
 * reached at all, which is the case the split above is about.
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
 *
 * **Awaiting `decode()` once is not enough, because the selection moves.**
 * `capture()` resizes the viewport immediately before this runs, and a resize
 * re-evaluates `sizes`/`srcset`, so `next/image` can swap an image to a
 * different candidate width — a source that has to be fetched, and that
 * `/_next/image` has to *generate* with sharp before any bytes exist. Awaiting
 * the decode of whatever was selected a moment earlier therefore proves nothing
 * about what the shot will contain. So the wait loops: decode everything
 * currently selected, then require both that no image is still loading and that
 * `currentSrc` did not change during the pass, which costs a mandatory second
 * pass and buys the guarantee. `VIEWPORTS` puts 390 first, so the light-390
 * capture of a photo page is the coldest moment in the whole run — first
 * viewport, first scheme, nothing generated yet — and it is exactly where this
 * surfaced: `course-page-light-vw-390` and `recap-light-vw-390` differing
 * run-to-run on an unchanged build, every glyph around the photos identical.
 *
 * The bound is reported, not silent. A capture that gives up on an image still
 * looks like a clean capture, so the old 5s-per-image race could ship a
 * half-loaded photo with nothing in the log to say so — the diff then reads as
 * an unexplained content change and costs a triage cycle. Like the frame waits,
 * hitting the bound now warns with a count.
 *
 * **Correction, found after this shipped.** `course-page-light-vw-390` kept
 * recurring — twice more, on unrelated PRs that touched no image code — after
 * the decode loop above was already in place, which the decode theory alone
 * does not explain. The actual mechanism: sharp's lossy re-encode is not
 * bit-reproducible between runs (threaded encoders), so every *optimized*
 * photo differed by a few channel values on every CI run regardless of
 * timing. `next.config.ts` now sets `images.unoptimized` for the e2e build,
 * which removes sharp — and the srcset-swap-requires-generation half of the
 * paragraph above — from the e2e path entirely; that config's comment is the
 * fix of record. The decode-loop mechanism above is unchanged and still
 * needed (a plain `<img>` still decodes asynchronously, and production still
 * runs the optimizer), but crediting it alone for the incident it was
 * partly-but-not-fully diagnosed from would be the same class of confident,
 * incomplete-justification mistake the debug skill's honesty rule warns
 * about — so this correction stays rather than getting quietly folded in.
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
 * widening (see the note on `SURFACE_TIMEOUT_MS` below).
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
// Budget for the whole image pass, not per image. It has to cover a cold
// `/_next/image` generating a width it has never been asked for, on a CI runner
// already running the other shards — the 5s this replaced was under that.
const IMAGE_SETTLE_MS = 15_000;

/**
 * The bounds above are all *page-side*, and a page-side bound cannot fire in a
 * renderer that has stopped running the page.
 *
 * `settle()` racing `requestAnimationFrame` against `setTimeout` was written to
 * close this class, on the theory that only frames were going missing. It did
 * not: the same hang still lands on CI — `Test timeout of 90000ms exceeded`
 * with the stack pointing at the `page.evaluate` below — and it lands on a
 * *different* capture every time (`schedule-builder` on one run, a diver record
 * on another), on pages that paint in under half a second locally, with no
 * stalled-frame warning anywhere in the run to say a budget was even
 * approached. A page burning its budget warns and returns; this returns
 * nothing. Whatever wedges the renderer takes `setTimeout` with it, so no
 * escape hatch written *inside* the evaluate can ever be the one that fires.
 *
 * So the outermost wait — the one Playwright leaves unbounded, since
 * `page.evaluate` takes no timeout of its own — gets the bound instead, and a
 * stall degrades the way every other stall here degrades: the shot is taken
 * anyway, possibly with an unpainted band, and the warning says so. That is the
 * standing trade in this file (see `settle()` above), applied to the one wait
 * that had no share in it. What it replaces is far worse than a blank stripe: a
 * wedged renderer failed the *shard*, a failed shard uploads no screenshots at
 * all, and `visual-report` then publishes no report — so one stuck page cost
 * the pull request every other surface's comparison too.
 *
 * On a stall we also ask the page one trivial question before giving up. The
 * answer is the measurement that tells the next person which half is broken —
 * a renderer that cannot even return `true` is wedged, one that answers
 * instantly means our own promise leaked — and neither the CI log nor the trace
 * distinguishes them today.
 */
const PAGE_SIDE_BUDGET_MS = SCROLL_BUDGET_MS + IMAGE_SETTLE_MS + 4 * FRAME_WAIT_MS;
/** Protocol round-trips and a contended runner's scheduling, not page work. */
const PROTOCOL_SLACK_MS = 5_000;
const PAINT_STALL_MS = PAGE_SIDE_BUDGET_MS + PROTOCOL_SLACK_MS;
const FONTS_STALL_MS = FONTS_WAIT_MS + PROTOCOL_SLACK_MS;
/** How long the is-the-renderer-alive probe gets to answer after a stall. */
const RENDERER_PROBE_MS = 5_000;
/**
 * The screenshot's own bound. Playwright defaults it to 30s, which is not a
 * number this file chose and not one the ceiling below accounted for — the old
 * `CAPTURE_OVERHEAD_MS` had 10s covering *both* shots, the resizes, and the
 * navigation. Naming it puts it back inside the derivation.
 */
const SCREENSHOT_TIMEOUT_MS = 15_000;
/**
 * The driver-side bound around each screenshot, because the option above is
 * provably not one on a wedged renderer. Measured on CI run 31147282309
 * (2026-08-07, visual shard 1): both `paintWholeDocument` waits stalled, the
 * probe said "wedged, not slow", and the subsequent `page.screenshot` — with
 * `timeout: 15_000` passed — then sat for 95+ seconds until the *test's* 164s
 * ceiling killed it. Playwright's screenshot timeout bounds the preparation
 * work (waiting for fonts, disabling animations), not the protocol call that
 * needs the renderer to answer, so a renderer that has stopped answering
 * hangs it indefinitely. Same shape as the `page.evaluate` story on
 * `PAGE_SIDE_BUDGET_MS` above: the outermost wait Playwright leaves unbounded
 * gets the bound here instead, in `screenshotOrGiveUp`.
 */
const SCREENSHOT_GIVE_UP_MS = SCREENSHOT_TIMEOUT_MS + PROTOCOL_SLACK_MS;

/**
 * The per-test ceiling for a plain navigate-and-shoot surface.
 *
 * The suite's 15s default (playwright.config.ts) is sized for one real flow,
 * and it was never enough for a capture: each one is *two* screenshots, and
 * each of those pays a full `paintWholeDocument` scroll-through plus a font and
 * image settle on a cold `/_next/image`. This is the number that used to be
 * spent eighteen times over inside one 90s tour.
 *
 * It is a ceiling that only ever bounds a failure, never a passing test — but
 * it is still not a knob to widen when a test starts timing out. A test that
 * outgrows it is doing more than shooting one surface, and the fix is to say so
 * at its own site with `test.setTimeout` and a comment naming the extra work
 * (a real booking, a settings round-trip, a board crawl), the way the tests
 * below that need more do.
 *
 * **Derived, not chosen.** It used to be a flat 30s, and that quietly stopped
 * being a ceiling-on-failure: every wait inside `paintWholeDocument` is bounded
 * so a stuck frame or a slow image degrades to a blank stripe rather than
 * costing the run, but those bounds add up to more than 30s — and `capture`
 * pays them once per viewport. When `IMAGE_SETTLE_MS` went 5s → 15s for cold
 * `/_next/image` on a loaded runner, nobody re-derived the ceiling, so a page
 * that used its budget honestly died on the outer timeout instead of shooting a
 * degraded frame. That is exactly the hang-instead-of-stripe failure the bounds
 * exist to prevent, and it is what made the review-moderation-queue capture
 * fail on CI while passing locally. Deriving it keeps the two in step: widen a
 * budget below and the ceiling follows.
 *
 * That derivation was still short in two places, which is why the number moved
 * again: it costed the *page-side* budgets and then left the two waits that
 * actually own the clock outside the sum — the `page.evaluate` calls, whose
 * stall bounds are now `PAINT_STALL_MS`/`FONTS_STALL_MS`, and the screenshots,
 * which had 10s between them for a shot Playwright will itself wait 30s for. So
 * the ceiling was, in the worst honest case, *below* the work it was meant to
 * bound. It is bigger now for the same reason it exists: it is the sum.
 *
 * It is also much harder to reach, and that is the point. Every wait under it
 * degrades on its own bound now, page-side and driver-side alike, so a slow
 * page shoots a stripe and a wedged renderer shoots whatever it has. Reaching
 * this ceiling means both viewports stalled *and* neither screenshot came back
 * — a browser that is gone, not a surface that is slow. Nothing here is a knob
 * to widen when one test starts timing out.
 */
const PAINT_BUDGET_MS = PAINT_STALL_MS + FONTS_STALL_MS;
/**
 * The bounded waits that each pay one `RENDERER_PROBE_MS` diagnostic on the
 * path that has already given up: `paintWholeDocument`'s scroll-through/image
 * settle and font settle, plus `screenshotOrGiveUp`'s probe on a screenshot
 * that never returned.
 *
 * This is *per viewport*, and that is the correction. The ceiling below is
 * documented as the sum of the work it bounds, but the overhead term used to
 * budget two probes total while a fully-wedged capture pays one per wait per
 * viewport — four. The missing 10s came out of the same term's allowance for
 * the resizes and the navigation, leaving those unfunded, so the honest
 * worst case (both viewports wedged, both screenshots timing out on their own
 * ceiling) landed just past the total and surfaced as a test timeout inside
 * `page.screenshot` rather than as the four warnings it should read as.
 *
 * Not a knob widened for one slow test: the sum was under-counted, and it is
 * counted here.
 *
 * **This corrects the ceiling; it does not stop renderers wedging.** Worth
 * being exact, because the first version of this comment claimed otherwise. A
 * wedge was observed on three consecutive runs of one branch — `/pricing`
 * (light, shard 1), a diver's record (dark, shard 3), the schedule board
 * (dark, shard 3) — and re-running the *same commit* came back clean, so it is
 * non-deterministic and unattributed (a fourth sighting, the landing page on
 * run 31147282309, wedged inside the first capture's first wait — before any
 * flow ran — so it is not accumulated state either). `main`'s four runs either
 * side of those carried no wedge warning at all, which is the opposite of what
 * 20260804's bound (fa51f893) recorded at the time it was written; whatever
 * makes a renderer stop answering here comes and goes.
 *
 * fa51f893's goal — a wedge must not cost the run every other surface's
 * comparison — is now met in two halves. Here: `screenshotOrGiveUp` bounds the
 * one call that still hung unbounded on a wedged renderer, so the test fails
 * in seconds with an error naming the wedge instead of burning this whole
 * ceiling. In ci.yml's visual job: a failed capture step whose log carries the
 * probe's "wedged, not slow" verdict reruns only the failed captures once —
 * the probe is what earns that rerun, by proving the failure was the browser
 * refusing to answer rather than anything a rerun could mask. Any failure
 * *without* that verdict stays red on the first attempt, exactly as before.
 */
const STALL_PROBES_PER_VIEWPORT = 3;
const STALL_PROBE_BUDGET_MS = RENDERER_PROBE_MS * STALL_PROBES_PER_VIEWPORT * VIEWPORTS.length;
/** The viewport resizes and the navigation that preceded them. */
const CAPTURE_OVERHEAD_MS = 10_000;
const SURFACE_TIMEOUT_MS =
  (PAINT_BUDGET_MS + SCREENSHOT_GIVE_UP_MS) * VIEWPORTS.length +
  STALL_PROBE_BUDGET_MS +
  CAPTURE_OVERHEAD_MS;

// Applied at file scope rather than per describe block, so every test in the
// file gets it whether or not it sits inside one and nothing depends on a
// nested describe inheriting its parent's configuration.
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });

/**
 * A test that runs a real flow — a booking, a mutation and its revert, a crawl
 * of the schedule board — before it can shoot anything. The surface ceiling
 * plus the flow, derived so it tracks the budgets the same way.
 */
const FLOW_ALLOWANCE_MS = 15_000;
const FLOW_TIMEOUT_MS = SURFACE_TIMEOUT_MS + FLOW_ALLOWANCE_MS;

/** The seeded reef charter, the departure most of the staff tour hangs off. */
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

/**
 * The three cert-gate departures from `src/db/seed-cert-gates.ts`. Each one can
 * be refused for exactly one reason, which is what lets a refusal capture show
 * a single sentence rather than three overlapping ones. They sit on days 29-32,
 * deliberately off the public schedule's first page — so reaching one means
 * crawling the staff board (`findTripOnBoard`), which is why every test below
 * that uses them buys extra budget.
 */
const ADVANCED_CHARTER = "Advanced Drift — French Reef Wall";
const DEEP_CHARTER = "Deep Adventure — USCGC Duane";
const AOW_COURSE = "Advanced Open Water Diver — two-day course";

/**
 * The is-the-renderer-alive question both stall paths ask before assigning
 * blame: can the page answer a trivial evaluate within `RENDERER_PROBE_MS`?
 * `true` means the page is alive and our own wait is what leaked; `false` is
 * the "wedged, not slow" verdict. One helper so `withRendererBound` and
 * `screenshotOrGiveUp` can never drift in how they measure it.
 */
async function probeRenderer(page: Page): Promise<boolean> {
  return Promise.race([
    page
      .evaluate(() => true)
      .then(
        () => true,
        () => false,
      ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), RENDERER_PROBE_MS)),
  ]);
}

/**
 * Await a page-side pass, but never further than `budgetMs` — see the note on
 * `PAINT_STALL_MS`. A pass that overruns is reported and the caller carries on
 * with `degraded`; a pass that *throws* still throws, because an evaluate that
 * fails is a broken page, not a stalled one, and must not be swallowed here.
 */
async function withRendererBound<T>(
  page: Page,
  what: string,
  budgetMs: number,
  work: Promise<T>,
  degraded: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Both outcomes are folded into a value rather than left as a rejection: the
  // losing arm of the race stays pending, and a `page.evaluate` that rejects
  // later — when the context is torn down at end of test — would otherwise
  // surface as an unhandled rejection in whatever test is running by then.
  const settled = work.then(
    (value) => ({ state: "done" as const, value }),
    (error: unknown) => ({ state: "failed" as const, error }),
  );
  const outcome = await Promise.race([
    settled,
    new Promise<{ state: "stalled" }>((resolve) => {
      timer = setTimeout(() => resolve({ state: "stalled" }), budgetMs);
    }),
  ]);
  clearTimeout(timer);
  if (outcome.state === "failed") throw outcome.error;
  if (outcome.state === "done") return outcome.value;

  const probeStart = Date.now();
  const responsive = await probeRenderer(page);
  // The exact phrase "wedged, not slow" is load-bearing: ci.yml's visual job
  // greps the capture log for it to decide whether a failed shard earned its
  // one-shot rerun of the failed captures. Reword it here (or in
  // `screenshotOrGiveUp`) and that gate silently stops firing.
  console.warn(
    `visual: ${what} did not return within ${budgetMs}ms at ${page.url()} — the shot may contain ` +
      "an unpainted band; check the diff for a blank stripe. The renderer " +
      (responsive
        ? `answered a trivial evaluate in ${Date.now() - probeStart}ms, so the page is alive and ` +
          "the pass itself never settled"
        : `did not answer a trivial evaluate within ${RENDERER_PROBE_MS}ms, so it is wedged, not slow`) +
      ".",
  );
  return degraded;
}

async function paintWholeDocument(page: Page) {
  const { stalled: stalledFrames, unsettled: unsettledImages } = await withRendererBound(
    page,
    "the scroll-through and image settle",
    PAINT_STALL_MS,
    page.evaluate(
      async ({ frameWaitMs, scrollBudgetMs, imageSettleMs }) => {
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
        // Commit every image to a source before anything else.
        //
        // `next/image` is lazy by default, so an image below the fold has
        // `currentSrc === ""` until its intersection observer fires — and the
        // pending check below deliberately skips those, because an image that
        // never intersects would otherwise burn the whole settle budget. Those
        // two facts combine into a race: the scroll-through can sweep past a tile
        // *without* tripping its observer in time, the loop then sees nothing
        // pending and breaks, and the image finishes loading somewhere either side
        // of the shutter. That is what made `trip-manage-dark-vw-390` alternate
        // between a sharp and a half-decoded diver photo run to run, on a page
        // nobody had touched.
        //
        // Promoting to `eager` here makes every image commit to a source
        // immediately, which puts it under the pending check where it belongs.
        // It does not add work: the scroll below visits the entire document, so
        // these images were always going to load — the only thing that changes is
        // that they are now guaranteed to have loaded *before* the screenshot
        // rather than racing it.
        for (const image of Array.from(document.images)) image.loading = "eager";

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

        const imageDeadline = performance.now() + imageSettleMs;
        const selectionOf = () =>
          Array.from(document.images)
            .map((image) => image.currentSrc)
            .join("\n");
        let unsettled = 0;
        for (;;) {
          const images = Array.from(document.images);
          // Sampled before the decode and re-read after it, so a swap that starts
          // *during* the await is caught without costing every settled page an
          // extra confirmation pass — this runs 32 times per scheme and the
          // test's own budget is not generous.
          const selectionBefore = selectionOf();
          await Promise.all(
            images
              // `decode()` on an image with no source selected never settles —
              // there is nothing to decode and nothing coming, so the promise
              // simply hangs and the race below burns its entire bound. The
              // trip-detail pages carry 14 such `loading="lazy"` tiles, which is
              // how one page came to cost the whole budget on every capture while
              // changing not a single pixel. Nothing to decode, nothing to wait
              // for: skip them and let the `pending` check below speak for them.
              .filter((image) => image.currentSrc !== "")
              .map(
                (image) =>
                  Promise.race([
                    image.decode().catch(() => undefined),
                    new Promise((resolve) =>
                      setTimeout(resolve, Math.max(0, imageDeadline - performance.now())),
                    ),
                  ]) as Promise<unknown>,
              ),
          );
          const selectionStable = selectionOf() === selectionBefore;
          // Pending means "a load is actually in flight", which is `!complete`
          // *and* a source already selected. Both halves matter:
          //
          // - `complete` goes true when an attempt *finishes*, success or failure,
          //   so a broken `src` is settled-and-stable, not pending — it renders
          //   identically every run.
          // - An empty `currentSrc` means the browser has not selected a source at
          //   all, which after the eager promotion above means there is nothing to
          //   select: no `src`, or one it has already given up on. Waiting on
          //   those spent the entire budget on every capture of the trip-detail
          //   pages and blew the test's own timeout.
          //
          //   This exclusion used to be load-bearing for *lazy* images too, and
          //   that is exactly what made it unsafe — a tile the scroll swept past
          //   without tripping its observer was skipped here and then loaded into
          //   the shutter. The promotion at the top of this function is what makes
          //   the exclusion honest: every image with a real source now commits to
          //   it before the scroll, so anything still empty here genuinely has
          //   nothing coming.
          const pending = Array.from(document.images).filter(
            (image) => !image.complete && image.currentSrc !== "",
          );
          if (pending.length === 0 && selectionStable) break;
          if (performance.now() > imageDeadline) {
            unsettled = pending.length;
            break;
          }
          await settle();
        }
        // One more frame so anything decoded above is composited before the shot.
        await settle();
        return { stalled, unsettled };
      },
      {
        frameWaitMs: FRAME_WAIT_MS,
        scrollBudgetMs: SCROLL_BUDGET_MS,
        imageSettleMs: IMAGE_SETTLE_MS,
      },
    ),
    // A stalled pass painted nothing it can report on, and the two warnings
    // below would be lying if they claimed a count; `withRendererBound` has
    // already said what happened.
    { stalled: 0, unsettled: 0 },
  );
  if (stalledFrames > 0) {
    console.warn(
      `visual: ${stalledFrames} frame wait(s) hit the ${FRAME_WAIT_MS}ms bound at ${page.url()} — ` +
        "a band may be captured unpainted; check the diff for a blank stripe.",
    );
  }
  if (unsettledImages > 0) {
    console.warn(
      `visual: ${unsettledImages} image(s) had not finished loading within the ` +
        `${IMAGE_SETTLE_MS}ms bound at ${page.url()} — the shot may contain a partly-loaded ` +
        "photo; check the diff for a changed image tile.",
    );
  }
  // Same reasoning as the frame waits: a webfont that never resolves must cost
  // one capture's sharpness, not the run. Bounded on both sides for the same
  // reason as the pass above — the page-side race is a `setTimeout`, and a
  // renderer that has stopped running the page will not fire that either.
  await withRendererBound(
    page,
    "the font settle",
    FONTS_STALL_MS,
    page.evaluate(
      (ms) =>
        Promise.race([
          document.fonts.ready.then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(true), ms)),
        ]),
      FONTS_WAIT_MS,
    ),
    true,
  );
}

/**
 * `page.screenshot`, raced against `SCREENSHOT_GIVE_UP_MS` on the driver side —
 * see that constant for the measured incident proving the call's own `timeout`
 * option does not fire on a renderer that has stopped answering. A shot that
 * never returns gets the same alive-probe `withRendererBound` runs, so the
 * thrown error says which half is broken: "wedged, not slow" is the verdict
 * ci.yml's visual job reads to earn a one-shot rerun of the failed captures.
 */
async function screenshotOrGiveUp(page: Page, path: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Folded to a value for the same reason as `withRendererBound`: the losing
  // arm must not surface later as an unhandled rejection at context teardown.
  const shot = page
    .screenshot({
      path,
      fullPage: true,
      // Finish every finite CSS animation/transition and pin infinite ones to
      // their first frame before the shot. `paintWholeDocument` settles
      // layout, fonts, and image decode; this settles *time*. A hover lift, a
      // toast slide-in, or the schedule's skeleton shimmer caught mid-curve is
      // a different image on every run, and the diff it produces looks exactly
      // like faint antialiasing noise around the moving element.
      animations: "disabled",
      // Playwright's own default here is 30s, which nothing in this file chose
      // and `SURFACE_TIMEOUT_MS` never costed. Named so the ceiling can see
      // it. Bounds the preparation only — the give-up race below is what
      // actually caps the call.
      timeout: SCREENSHOT_TIMEOUT_MS,
    })
    .then(
      () => ({ state: "done" as const }),
      (error: unknown) => ({ state: "failed" as const, error }),
    );
  const outcome = await Promise.race([
    shot,
    new Promise<{ state: "hung" }>((resolve) => {
      timer = setTimeout(() => resolve({ state: "hung" }), SCREENSHOT_GIVE_UP_MS);
    }),
  ]);
  clearTimeout(timer);
  if (outcome.state === "failed") throw outcome.error;
  if (outcome.state === "done") return;

  const responsive = await probeRenderer(page);
  throw new Error(
    `visual: page.screenshot did not return within ${SCREENSHOT_GIVE_UP_MS}ms at ${page.url()} ` +
      `(${path}). The renderer ` +
      (responsive
        ? "answered a trivial evaluate, so the page is alive and the screenshot itself is stuck — " +
          "investigate; this is not the known wedge."
        : "did not answer a trivial evaluate, so it is wedged, not slow — the known, " +
          "unattributed Chromium wedge (see the debug skill's visual-capture section)."),
  );
}

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  const baseViewport = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await paintWholeDocument(page);
    await screenshotOrGiveUp(page, `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`);
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
  await screenshotOrGiveUp(page, `e2e/screenshots/${name}-print.png`);
  await page.emulateMedia({ media: "screen" });
}

// ---------------------------------------------------------------------------
// Shared setup.
//
// One surface per test means the navigation each surface needs is now written
// once here rather than inherited from whatever ran earlier in a tour. These
// only *reach* a surface; every capture site still does its own readiness wait,
// because what proves a page has rendered is a property of that page.

/** The seeded reef charter's card on the public schedule, once it is real. */
function publicReefCard(page: Page) {
  return page.locator("li").filter({ hasText: REEF_TRIP });
}

/** Open the seeded reef charter's staff record, the way staff reach it. */
async function openReefTrip(page: Page) {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, REEF_TRIP);
}

/**
 * One diver's record, found by search rather than by scrolling: the demo shop
 * has enough divers to page the roster, so nobody is reliably on the first
 * page.
 *
 * Parks the pointer at (0,0) before returning. The roster row this clicks sits,
 * at 390, exactly where the record's sub-nav bar lands — so the pointer left
 * behind by the click renders one tab in its hover state, and the phone
 * baselines photographed a "Fit" that looked selected. Deterministic, so never
 * a flake; just a lie about state that a reviewer has to re-derive every time.
 * (0,0) is the demo banner, which has nothing hoverable in the corner.
 */
async function openDiverProfile(page: Page, search: string, fullName: string, initials: string) {
  await page.goto(`/shop/blue-mantis/divers?q=${search}`);
  await page
    .getByRole("row")
    .filter({ hasText: fullName })
    .getByText(initials, { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("heading", { level: 1, name: fullName }).waitFor();
  await page.mouse.move(0, 0);
}

/**
 * The same id, read on a disposable staff context so the test's own `page`
 * stays the unauthenticated visitor it is capturing as — the CR-019 pattern the
 * waiver and recap setups below use, rather than signing in and clearing
 * cookies afterwards.
 */
async function tripIdWithoutSigningIn(
  browser: Browser,
  storageState: string,
  title: string,
): Promise<string> {
  const context = await browser.newContext({ storageState });
  try {
    return await seededTripId(makeActivitySafe(await context.newPage()), "blue-mantis", title);
  } finally {
    await context.close();
  }
}

/**
 * Book the seeded reef charter as a fresh visitor and settle on the
 * confirmation. Shared by the `booking-confirmed` and `readiness` captures,
 * which each run it against their own reseeded fixture.
 *
 * The name and email are fixed per scheme rather than unique per run: both
 * render on the confirmation, so a wall-clock or random value there would be a
 * permanent diff between CI runs rather than a regression.
 */
async function bookAVisualRegressionSeat(page: Page, scheme: "light" | "dark") {
  await page.goto("/s/blue-mantis");
  await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
  await page.getByLabel("Email", { exact: true }).fill(`visual-regression-${scheme}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
}

/** The IndexedDB names `src/lib/offline-manifest-store.ts` writes under. */
const OFFLINE_DB = "diveday-offline-manifests";
const OFFLINE_KEY_STORE = "keys";
const OFFLINE_MANIFEST_STORE = "manifests";
const OFFLINE_KEY_ID = "manifest-aes-gcm-v1";

/**
 * An `expiresAt` far enough in the past that the pending-event reprieve has
 * run out — see `OFFLINE_MANIFEST_PENDING_GRACE_MS`. Derived from the frozen
 * clock and the constant itself rather than written as "29 days ago", so
 * shortening the ceiling in the product does not silently leave this seed on
 * the wrong side of it.
 */
const PAST_PENDING_GRACE = new Date(
  Date.parse(E2E_FROZEN_CLOCK) - OFFLINE_MANIFEST_PENDING_GRACE_MS - 24 * 60 * 60 * 1000,
).toISOString();

/** A shop that is not the seeded one, for the cross-shop purge. */
const OTHER_SHOP = { slug: "reef-runners", name: "Reef Runners" };

/**
 * Rewrite one saved offline record in place, through the store's own AES key.
 *
 * Two of the offline shell's states are only reachable from a record in a
 * condition the app cannot be asked to produce on a fresh fixture: one that has
 * been sitting on this device for weeks past its retention window while still
 * holding roll call that never sent, and one saved by a *different* shop than
 * the session the tablet now holds. Both are ordinary records otherwise, so
 * this takes a real one the app just wrote and edits the two facts that matter.
 *
 * It decrypts and re-encrypts rather than fabricating an envelope: the key is
 * non-extractable and lives in the same database, the AAD is
 * `<version>:<tripId>` (`OFFLINE_MANIFEST_RECORD_VERSION`, imported so a bump
 * cannot leave this seeding silently undecryptable), and everything not named
 * below stays exactly what the product wrote — the roster, the shop timezone,
 * the snapshot id. A hand-built payload would be a second copy of the snapshot
 * shape to keep in step, and it would photograph a roster nobody ships.
 *
 * **Call it from `/offline-manifest`, never from a `/shop/**` page.** The staff
 * shell mounts `OfflineManifestAutoSave` (and the manifest page its own
 * manager), either of which can overwrite this record from a save round already
 * in flight; the offline shell is the one surface in the app that never writes
 * one.
 */
async function rewriteSavedOfflineRecord(
  page: Page,
  tripId: string,
  change: {
    shop?: { slug: string; name: string };
    expiresAt?: string;
    /** Roll-call events to queue as never-sent, one per diver on the roster. */
    pendingRollCalls?: number;
  },
) {
  await page.evaluate(
    async ({ tripId, change, recordVersion, names }) => {
      const openDatabase = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(names.db);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("could not open the store"));
        });
      const read = <T>(db: IDBDatabase, store: string, key: string) =>
        new Promise<T | undefined>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).get(key);
          request.onsuccess = () => resolve(request.result as T | undefined);
          request.onerror = () => reject(request.error ?? new Error("could not read the store"));
        });

      const db = await openDatabase();
      try {
        const key = await read<CryptoKey>(db, names.keyStore, names.keyId);
        const record = await read<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }>(
          db,
          names.manifestStore,
          tripId,
        );
        if (!key || !record) throw new Error(`no offline record saved for trip ${tripId}`);
        const additionalData = new TextEncoder().encode(`${recordVersion}:${tripId}`);
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv, additionalData },
          key,
          record.ciphertext,
        );
        const envelope = JSON.parse(new TextDecoder().decode(plaintext)) as {
          snapshot: {
            shop: { slug: string; name: string };
            snapshotId: string;
            savedAt: string;
            expiresAt: string;
            manifests: Array<{ divers: Array<{ bookingId: string }> }>;
          };
          events: unknown[];
        };

        if (change.shop) envelope.snapshot.shop = { ...envelope.snapshot.shop, ...change.shop };
        if (change.expiresAt) envelope.snapshot.expiresAt = change.expiresAt;
        for (let index = 0; index < (change.pendingRollCalls ?? 0); index += 1) {
          const bookingId = envelope.snapshot.manifests[0]?.divers[index]?.bookingId;
          if (!bookingId) throw new Error("the saved roster has too few divers to record against");
          envelope.events.push({
            // Fixed rather than randomUUID: this rides in the encrypted
            // payload, so a per-run value would be a per-run ciphertext.
            clientEventId: `visual-${tripId}-${index}`,
            snapshotId: envelope.snapshot.snapshotId,
            snapshotSavedAt: envelope.snapshot.savedAt,
            tripId,
            bookingId,
            checkpoint: "departure",
            status: "not_boarded",
            note: null,
            occurredAt: envelope.snapshot.savedAt,
            syncStatus: "pending",
          });
        }

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData },
          key,
          new TextEncoder().encode(JSON.stringify(envelope)),
        );
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(names.manifestStore, "readwrite");
          // `expiresAt` is stored beside the ciphertext in the clear, and it is
          // the copy both the retention check and the grace ceiling read — so
          // it has to move with the one inside the envelope, or the record
          // would claim two different expiries.
          transaction.objectStore(names.manifestStore).put({
            tripId,
            expiresAt: envelope.snapshot.expiresAt,
            iv: iv.buffer,
            ciphertext,
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () =>
            reject(transaction.error ?? new Error("could not write the store"));
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("the store write was aborted"));
        });
      } finally {
        db.close();
      }
    },
    {
      tripId,
      change,
      recordVersion: OFFLINE_MANIFEST_RECORD_VERSION,
      names: {
        db: OFFLINE_DB,
        keyStore: OFFLINE_KEY_STORE,
        manifestStore: OFFLINE_MANIFEST_STORE,
        keyId: OFFLINE_KEY_ID,
      },
    },
  );
}

/**
 * The offline shell's tenant lookup. Refusing it is how both tests below hold
 * the cross-shop purge still: `fetchOfflineManifestShopSlug` answers `null` for
 * a refused request exactly as it does for no signal, and the purge declines to
 * run rather than guess a shop — which is also the shell's own everyday state,
 * since it exists for the tablet that cannot reach DiveDay.
 */
const IDENTITY_ROUTE = "**/api/offline-manifests/identity*";

/**
 * Open the seeded reef charter's live manifest, wait for the device copy it
 * saves in the background, and leave the page on the offline shell with the
 * tenant lookup refused — ready for `rewriteSavedOfflineRecord`.
 *
 * Both halves of that landing are load-bearing, and the second one was found
 * the hard way. Being on `/offline-manifest` keeps the staff shell's auto-save
 * from overwriting the record (see `rewriteSavedOfflineRecord`); refusing the
 * lookup *before* the shell is ever opened keeps the purge from deleting it.
 * The shell starts a purge round on mount and only reaches the store once its
 * tenant request comes back, which is long after the list has painted — so a
 * rewrite made on the strength of "the heading is up" lands in the middle of
 * that round, and a record rewritten to another shop's name is then correctly
 * purged before the test can go look at it. With no tenant there is no purge,
 * and the seed sits still until the test asks for one.
 */
async function savedOfflineRecordFor(page: Page): Promise<string> {
  await openReefTrip(page);
  await openTripTab(page, "Manifest");
  await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error(`could not read a trip id from ${page.url()}`);
  await page.route(IDENTITY_ROUTE, (route) => route.abort());
  await page.goto("/offline-manifest");
  // The with-trips heading, so this also proves the store was read and the
  // rows are on screen — the empty branch says "Nothing saved on this device
  // yet" instead, and a rewrite against a record the list never found would
  // throw somewhere less obvious.
  await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
  return tripId;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("public", () => {
      test(`the landing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/");
        await capture(page, "landing", scheme);
      });

      // The other two buyer-facing sales surfaces: the product narrative
      // (readiness, dock, diver arc, honest-no scope) and the pricing page
      // with its objection FAQ. Copy changes here are product changes.
      test(`the product page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/product");
        await capture(page, "product", scheme);
      });

      test(`the pricing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/pricing");
        await capture(page, "pricing", scheme);
      });

      // Where the trial actually starts: the form plus the reassurance block a
      // skeptical owner reads before typing a password.
      test(`the onboarding form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/onboard");
        // This route owns a loading.tsx, and `goto` resolves on the document
        // load event while the body is still streaming — a bare capture here
        // once shot the skeleton and published it as the baseline
        // (onboard-light-vw-390, caught only when the next PR's correct
        // render diffed against it). The page's own <h1> is the readiness
        // proof: every page renders one, no skeleton does. Same wait on every
        // capture below whose route owns a loading.tsx.
        await page.locator("h1").first().waitFor();
        await capture(page, "onboard", scheme);
      });

      test(`the sign-in page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/sign-in");
        await capture(page, "sign-in", scheme);
      });

      // The same form after a signed-out visitor followed a `/shop/**` link:
      // Auth.js's `callbackUrl` names the shop, so the page offers that shop's
      // public schedule instead of leaving a diver at a staff password field.
      test(`the sign-in shop escape hatch renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/sign-in?callbackUrl=%2Fshop%2Fblue-mantis%2Fdivers");
        await capture(page, "sign-in-shop-escape", scheme);
      });

      test(`the forgot-password page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password", scheme);
      });

      // The token pages' one always-reachable state: an unrecognized token
      // never renders anything but this same closed notice (no live token to
      // capture the confirm/reset form with — see e2e/account-lifecycle.spec.ts).
      test(`the invalid email-verification notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/verify/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "verify-invalid", scheme);
      });

      test(`the invalid password-reset notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/reset-password/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "reset-password-invalid", scheme);
      });

      test(`the invalid unsubscribe notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/unsubscribe/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "unsubscribe-invalid", scheme);
      });

      // Wait for a real departure card, not the loading skeleton: this capture
      // used to `goto` and shoot immediately, so it raced the schedule's
      // suspense fallback and whichever side of that race each run landed on
      // decided the baseline. Two runs catching *different* skeleton frames is
      // what produced the schedule-dark diffs on builds with no code change.
      test(`the public schedule renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link").waitFor();
        await capture(page, "schedule", scheme);
      });

      // The unsupported-language band (I18N-L1). Every other capture in this
      // file runs under the fleet's default locale, so nothing here has ever
      // rendered this surface — and a shop cannot reproduce it on its own
      // machine either, which is exactly why it wants a baseline. `de-DE` is a
      // language DiveDay carries no bundle for, so `unsupportedLanguage()`
      // answers and the band appears under the shop header.
      test.describe("unsupported language", () => {
        test.use({ locale: "de-DE" });

        test(`the schedule's language-fallback band renders true to the design (${scheme})`, async ({
          page,
        }) => {
          await page.goto("/s/blue-mantis");
          await publicReefCard(page).getByRole("link").waitFor();
          await capture(page, "schedule-language-fallback", scheme);
        });
      });

      // The embed widget's compact surface (docs ADR 20260726-schedule-embed):
      // no ShopPageHeader chrome, tighter padding — what a shop's own website
      // actually shows inside the iframe.
      // Same settle wait as the standalone schedule above, and for a sharper
      // reason: with no wait this capture sometimes shot an empty document, so
      // `fullPage` measured the viewport (844px tall) instead of the real page
      // (11802px). A baseline that is a blank viewport asserts nothing.
      test(`the embedded schedule renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis?embed=1");
        await publicReefCard(page).getByRole("link").waitFor();
        await capture(page, "schedule-embed", scheme);
      });

      // The seeded reef trip's public briefing: satellite map, gentle route,
      // landmarks, and the field guide — DiveDay's flagship "delight" surface.
      //
      // Reached from the *standalone* schedule, never the embed: a schedule
      // loaded with `embed=1` carries the flag forward on its trip links, and
      // this baseline is the full-chrome page. Its own test now, so that can no
      // longer depend on which capture ran before it.
      test(`the public trip briefing renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page.getByTitle("Satellite map of Molasses Reef").waitFor();
        await capture(page, "site-briefing", scheme);
      });

      /**
       * The same page on a charter that actually gates, so the "Who this trip
       * is for" note names a level *above* the shop's default (ADR
       * 20260803-trip-admission-at-booking). `site-briefing` above already
       * photographs the note in its shop-default form — every non-course
       * charter states Open Water — but not the raised form, which is the one a
       * diver is refused against and the one whose wording carries a level
       * name assembled from the trip's own requirement row.
       *
       * Advanced Drift is the uncontaminated case from
       * `src/db/seed-cert-gates.ts`: a level and nothing else, at a site with no
       * gate of its own. Its day-31 departure is deliberately off the public
       * schedule's first page, so the id comes off the staff board on a
       * disposable context and `page` never holds a session.
       */
      test(`the public trip page's requirement note renders true to the design (${scheme})`, async ({
        page,
        browser,
        staffStorageState,
      }) => {
        // A board crawl on a second context, then the capture. Same
        // aggregate-cost reasoning as the waiver and recap tests below.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await tripIdWithoutSigningIn(
          browser,
          await staffStorageState("owner"),
          ADVANCED_CHARTER,
        );
        await page.goto(`/s/blue-mantis/trips/${tripId}`);
        await page.getByRole("heading", { name: "Who this trip is for" }).waitFor();
        // The booking form is a Client Component below the note; wait for it to
        // hydrate so the shot is of the settled page, not of the form mounting.
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await capture(page, "site-briefing-requirements", scheme);
      });

      // "Upcoming dates" is the last section the public course page streams, so
      // it is the signal that the whole document has landed — without it this
      // capture also shot a viewport-tall blank page on some runs.
      test(`the public course page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/courses/open-water-diver");
        await page.getByRole("heading", { name: "Upcoming dates" }).waitFor();
        await capture(page, "course-page", scheme);
      });

      // The diver's catalog index. It used to be the signed-out half of a
      // staff page inside /shop and so had no baseline of its own; it is a
      // standalone public surface now (ADR 20260803-public-shop-namespace).
      test(`the public course catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "public-courses", scheme);
      });

      /**
       * The post-trip recap: a signed-token diver page minted for the pinned
       * demo booking (src/db/seed.ts), so the marquee word-of-mouth surface has
       * a stable baseline without an in-app link to reach it.
       *
       * Two pieces of setup it cannot render without. The review section (docs
       * ADR 20260726-post-trip-review-request) needs the shop's review link
       * set, done on a disposable staff context (the CR-019 pattern) so the
       * public `page` never holds a session. The tip section (docs ADR
       * 20260726-post-trip-tipping) needs a connected, charges-enabled Stripe
       * account — `canAcceptPayments` is a pure DB check, independent of
       * whether STRIPE_SECRET_KEY is set — so /api/test/seed-stripe-account
       * marks the demo shop connected without ever calling Stripe, purely to
       * render the surface for this capture. The actual checkout button stays
       * inert (no STRIPE_SECRET_KEY in this fleet), the same reason no capture
       * here exercises a real charge.
       */
      test(`the post-trip recap renders true to the design (${scheme})`, async ({
        page,
        browser,
        staffStorageState,
        request,
      }) => {
        // A settings round-trip on a second context, a test-route write, then
        // the tallest capture in the file.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const reviewSettingsContext = await browser.newContext({
          storageState: await staffStorageState("owner"),
        });
        const reviewSettingsPage = makeActivitySafe(await reviewSettingsContext.newPage());
        await reviewSettingsPage.goto("/shop/blue-mantis/settings");
        await openSettingsRow(reviewSettingsPage, "Review link");
        await reviewSettingsPage
          .getByLabel("Review link (optional)", { exact: true })
          .fill("https://g.page/r/blue-mantis/review");
        await reviewSettingsPage.getByRole("button", { name: "Save review link" }).click();
        await reviewSettingsPage
          .getByText("Review link saved.")
          .filter({ visible: true })
          .waitFor();
        await reviewSettingsContext.close();

        await request.post("/api/test/seed-stripe-account");
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: /Nice diving/ }).waitFor();
        await page.getByRole("heading", { name: "Tip your crew" }).waitFor();
        await capture(page, "recap", scheme);
      });

      /**
       * Active (unsigned) waiver — the safety-critical form itself, before any
       * signature or medical answer is entered.
       *
       * Minting the link is a real send-waiver action, run on a disposable
       * staff context so `page` stays the same unauthenticated visitor
       * throughout, exactly as a real diver reaches the link.
       */
      test(`the unsigned waiver renders true to the design (${scheme})`, async ({
        page,
        browser,
        staffStorageState,
      }) => {
        // Board → trip → Guests → send, on a second context, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const staffContext = await browser.newContext({
          storageState: await staffStorageState("owner"),
        });
        const staffPage = makeActivitySafe(await staffContext.newPage());
        await staffPage.goto("/shop/blue-mantis/schedule/board");
        await staffPage
          .locator("li")
          .filter({ hasText: REEF_TRIP })
          .getByRole("link", { name: REEF_TRIP, exact: true })
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
        await diverSection
          .getByRole("button", { name: "Send waiver", exact: true })
          .first()
          .click();
        const resultNotice = diverSection.getByRole("status");
        await resultNotice.waitFor();
        const waiverHref = await resultNotice.getByRole("link").getAttribute("href");
        await staffContext.close();

        await page.goto(waiverHref ?? "/");
        await page.getByRole("heading", { name: "A quick step before the dock" }).waitFor();
        await capture(page, "waiver-active", scheme);
      });

      /**
       * The moment the whole public funnel exists for, and until recently the
       * one step of it with no baseline: the schedule, the trip page, and the
       * readiness checklist either side of it were all captured, but the
       * confirmation a diver actually celebrates on was not.
       *
       * It and `readiness` below each run their own booking rather than sharing
       * one. That used to be forbidden — a second real booking inside the
       * public tour would have moved the seat counts every capture after it
       * depended on (CR-019) — but the per-test `demoReset` in e2e/fixtures.ts
       * reseeds the demo shop before each of these, so each books against the
       * same fixture and neither can see the other's seat.
       */
      test(`the booking confirmation renders true to the design (${scheme})`, async ({ page }) => {
        // A real booking through the public form, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await capture(page, "booking-confirmed", scheme);
      });

      // The pre-trip checklist a diver actually uses on the way to the dock,
      // reached by the readiness link the confirmation hands back. This is a
      // fresh unpaid booking, so the "Need to change your plans?"
      // reschedule/cancel section (docs ADR 20260727-diver-self-service-cancel)
      // renders too — no separate capture needed, it's part of this same
      // full-page screenshot.
      test(`the diver readiness checklist renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        const readinessHref = await page
          .getByRole("link", { name: /readiness page/ })
          .getAttribute("href");
        await page.goto(readinessHref ?? "/");
        await page.getByRole("heading", { name: "Your pre-trip checklist" }).waitFor();
        await capture(page, "readiness", scheme);
      });

      /**
       * The group-organizer surfaces (docs ADR 20260804-seat-claim-links),
       * both sides of one flow: the organizer's confirmation with the
       * "Your group's seats" claim panel, then the claim page an invited
       * diver opens from the shared link. A real party booking through the
       * public form — `demoReset` reseeds the fixture, so the two extra
       * seats never move any other capture's counts.
       */
      test(`the party organizer confirmation and claim page render true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        const partySize = page.getByLabel("Number of divers");
        await expect(partySize).toHaveAttribute("data-hydrated", "true");
        await partySize.selectOption("2");
        await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
        await page.getByLabel("Email", { exact: true }).fill(`organizer-${scheme}@example.com`);
        await page.getByLabel("Diver 2 name").fill("Sam Reyes");
        await page.getByLabel("Use the main contact's email for this diver").check();
        await page.getByRole("button", { name: /^Book/ }).click();
        await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
        await page.getByRole("heading", { name: "Your group’s seats" }).waitFor();
        await capture(page, "party-organizer-confirmation", scheme);

        // Collapsed disclosure — the token never renders as pixels (that's
        // what keeps this capture stable run to run), but the text is in the
        // DOM for textContent.
        const claimUrlText =
          (await page
            .locator("li")
            .filter({ hasText: "Sam Reyes" })
            .locator("p.font-mono")
            .textContent()) ?? "";
        const claimPath = claimUrlText.match(/\/claim\/[^\s/?#]+/)?.[0];
        await page.goto(claimPath ?? "/");
        await page.getByRole("heading", { name: /A seat on/ }).waitFor();
        await capture(page, "seat-claim", scheme);
      });

      // Its own test rather than another stop on a public tour: a trust page
      // whose baseline is skipped because a long test ran out of budget is the
      // one baseline you'd most want.
      test(`the about page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/about");
        await capture(page, "about", scheme);
      });

      // The migration-guides hub: one card per incumbent a shop might be
      // leaving, the entry point to the portability wedge on the marketing side.
      test(`the switching hub renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching");
        await page.getByRole("heading", { name: "The door swings both ways." }).waitFor();
        await capture(page, "switching-hub", scheme);
      });

      // The "Switching from EVE" migration guide: the marketing face of the
      // portability wedge — export click-path, the shared scope table, and the
      // importer, on the market's most motivated switching pool. Represents the
      // shared guide template every live incumbent page renders.
      test(`the EVE switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/eve");
        await page.getByRole("heading", { name: "Moving your shop off EVE" }).waitFor();
        await capture(page, "switching-eve", scheme);
      });

      // The non-incumbent switching guide: shops coming from a spreadsheet — the
      // market's largest under-served pool. Its own layout (columns-that-matter,
      // the downloadable template, the free-import offer) around the same shared
      // honesty table every guide renders.
      test(`the spreadsheet switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/spreadsheet");
        await page.getByRole("heading", { name: "The spreadsheet got you this far." }).waitFor();
        await capture(page, "switching-spreadsheet", scheme);
      });

      // The FareHarbor guide: the coexist-led variant of the template, for a
      // booking channel a shop keeps rather than a records system it leaves —
      // the "keep it, or leave it" section (run-the-day cards + the leave path)
      // that no other guide renders.
      test(`the FareHarbor switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/fareharbor");
        await page
          .getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-fareharbor", scheme);
      });

      // The Rezdy guide: the second booking-channel guide, same coexist template
      // with its own copy (a monthly-plus-per-booking model). Baselined so its
      // page — and the extra hub card it adds — stay pixel-stable.
      test(`the Rezdy switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/rezdy");
        await page
          .getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-rezdy", scheme);
      });

      /**
       * The seeded demo shop's Today queue never runs dry, so the shared
       * `EmptyState` card TodayQueue now renders when nothing needs attention
       * (docs/design/principles.md, terminal-vs-section empty states) has no
       * other baseline. A freshly onboarded shop is the real "empty queue"
       * scenario — same flow as e2e/onboard.spec.ts's first-run checklist test.
       *
       * **Two captures in one test, deliberately.** `settings-trial` is
       * this shop's Settings page — the trial-status card only ever renders
       * for a real (non-demo) trial shop, so `blue-mantis` (the seeded demo
       * shop the other settings capture uses) can never show it. (A third
       * capture, `nav-more-menu`, retired with the "More" menu itself when
       * the header became six tabs.) Both
       * images contain the shop's slug — the first-run checklist renders the
       * public schedule URL. A second test would have to onboard a *second*
       * shop, because `/api/test/reset` reseeds the demo shop and purges
       * minted demo shops but does not delete one created through `/onboard`,
       * so the slug would have to differ — and a different slug is different
       * pixels in every baseline. Splitting here would move a baseline to buy
       * isolation, which is the wrong trade; the captures are one
       * onboarded session anyway. The trial card itself is clock-anchored and
       * deterministic: this shop's `created_at` is the harness's one frozen
       * instant, so "21 days left" and the end date never drift between runs.
       */
      test(`a freshly onboarded shop's Today tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A real sign-up flow, then two captures.
        test.setTimeout(FLOW_TIMEOUT_MS);
        // Deterministic, not Date.now(): this slug renders on screen (the
        // "Share your public schedule" URL), and neither DIVEDAY_CLOCK nor the
        // browser-context clock fixture freezes a value read in the Node.js
        // test process itself — a wall-clock slug here is a permanent visual
        // diff between CI runs, not a real regression. `scheme` alone
        // (light/dark) is unique enough since this test runs once per scheme
        // and the suite has no retries (playwright.config.ts).
        const unique = `today-empty-${scheme}`;
        await page.goto("/onboard");
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Fresh Shop E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));
        await page.getByRole("heading", { name: "Get your shop ready" }).waitFor();
        await page.getByRole("heading", { name: "Nothing is waiting on you" }).waitFor();
        await capture(page, "today-empty", scheme);

        // The "More" menu capture retired with the menu itself: the header is
        // six tabs now (every former menu row is a tab, a palette row, or a
        // contextual door), so there is no panel left to photograph — the
        // header's own pixels are in every staff capture already.

        // Same session, straight to Settings: the one place a trial shop's
        // owner sees the trial-status card (days left, upgrade-by-email CTA).
        await page.goto(`/shop/${unique}/settings`);
        await page.getByRole("heading", { name: "Your trial" }).waitFor();
        await capture(page, "settings-trial", scheme);
      });

      /**
       * The bookable moment: the first departure ever landing on the board is
       * the exact instant the first-run checklist (and the share link it
       * carried) leaves Today, so the created notice grows into a share card
       * exactly once — e2e/first-ten-minutes.spec.ts drives the behavior, this
       * is the surface. Same fresh-shop-per-scheme pattern (and deterministic
       * slug reasoning) as the `today-empty` capture above: the slug renders
       * inside the card, so it must not contain a wall-clock stamp.
       */
      test(`the first bookable moment renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const unique = `bookable-${scheme}`;
        await page.goto("/onboard");
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Bookable Moment E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));

        // The first (and only-ever-first) departure, dated off the frozen
        // clock so the card and queue rows render pixel-identically per run.
        await page.goto(`/shop/${unique}/schedule/board?add=1`);
        const tomorrow = new Date(Date.parse(E2E_FROZEN_CLOCK) + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await page.locator('input[name="title"]').fill("Two-Tank Morning Reef");
        await page.locator('input[name="date"]').fill(tomorrow);
        await page.locator('input[name="startTime"]').fill("08:00");
        await page.locator('input[name="endTime"]').fill("12:30");
        await page.getByRole("button", { name: "Put it on the board" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}\\?created=`));
        await page.getByRole("heading", { name: /your shop is bookable/ }).waitFor();
        await capture(page, "today-first-bookable", scheme);
      });
    });

    /**
     * The marketing header's second face. `MarketingNavView` renders two
     * different bars off one session read: signed out it offers "Sign in" and
     * "Start a trial"; signed in it drops the sign-in link entirely and turns
     * the CTA slot into the way back to that staffer's own shop. Every public
     * capture above is the signed-out bar, so the signed-in one — the header a
     * shop owner actually sees every time they come back to read the pricing
     * page — had no baseline at all.
     *
     * Its own `test.describe` because `signedInAsOwner()` is a describe-scoped
     * `storageState`; the sibling "public" block must stay anonymous.
     *
     * Shot on `/onboard` rather than the landing page for two reasons. It is
     * the shortest marketing surface (one form), so the duplicated body below
     * the header costs the least; and it is the one page that sets
     * `hideTrialCta`, where the signed-in branch has a documented rule with
     * nothing watching it — the trial *pitch* is suppressed, but the way back
     * to your own shop is wayfinding and still renders. The header markup is
     * identical on every marketing route, so this frame is the state, not a
     * special case of it.
     */
    test.describe("public, signed in", () => {
      signedInAsOwner();

      test(`the marketing header renders true to the design for a signed-in staffer (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/onboard");
        // Wait on the signed-in CTA itself, not the page heading: the heading
        // renders in the static shell, so it proves nothing about the
        // session-aware nav having streamed in over MarketingNavFallback.
        // Scoped to the banner because the footer grew its own session-aware
        // "Go to shop" link when it was aligned with the nav (#394). That one
        // streams in from a different server component, so waiting on whichever
        // resolved first would let the header still be showing its fallback at
        // capture time — the one thing this frame exists to catch.
        //
        // By landmark role rather than by the nav's accessible name: that name
        // is `t("nav.mainNavigation")`, a message-bundle string, so matching on
        // its English text would couple this spec to one locale. `banner` is
        // the `<header>` the nav sits in and carries no copy.
        await page.getByRole("banner").getByRole("link", { name: "Go to shop" }).waitFor();
        await capture(page, "marketing-nav-signed-in", scheme);
      });
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`the Today queue renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await capture(page, "today", scheme);
      });

      // The blocker queue — until recently the one staff surface with no
      // baseline at all, because a flat unpaginated list of every blocked
      // diver across every upcoming departure rendered a ~10,700px page
      // nothing could capture sanely (the same shape the orders index was
      // found in). Two bounds now: the shared operational horizon decides
      // which departures it holds, the pager how many render at once.
      //
      // It is Today's by-departure *view* rather than a route of its own
      // since Not ready folded into the shop home, so this navigates through
      // the redirect the old URL still serves and keeps the `blockers`
      // capture name.
      test(`the by-departure "Not ready" view renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/blockers");
        await page.getByRole("heading", { name: "Not ready", level: 2 }).waitFor();
        await capture(page, "blockers", scheme);
      });

      // Counter mode itself — the third surface reading the shared
      // operational window (task 141). Only its walk-in sub-page had a
      // baseline before, so the queue staff actually stand in front of, and
      // the window note the three surfaces now share, went uncaptured.
      test(`counter check-in renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in");
        await page.getByRole("heading", { name: "Counter check-in", level: 1 }).waitFor();
        await capture(page, "check-in", scheme);
      });

      // The queue's settled state: a checked-in diver's row wearing the
      // roll-call grammar — success rule, "Checked in ☑️", the re-tap undo
      // hint — beside rows still waiting. The default capture above can never
      // show this (the seed checks nobody in), and it is the half of the
      // one-tap design a mis-styled row would silently break.
      test(`counter check-in's settled row renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/check-in");
        await page.getByRole("button", { name: "Check in Diego Alvarez" }).click();
        await page.getByRole("button", { name: "Undo check-in for Diego Alvarez" }).waitFor();
        await capture(page, "check-in-checked", scheme);
      });

      // The end-of-day close-out (ADR 20260804-day-closeout): the ritual
      // surface Today mirrors at 5 p.m. Captured over the plain seed state —
      // today's boat still ahead of the frozen clock, real leftovers, and
      // tomorrow's glance — so the calm-but-populated shape is the baseline.
      test(`the day close-out renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/close-out");
        await page.getByRole("heading", { name: "How today's boats ended" }).waitFor();
        await capture(page, "close-out", scheme);
      });

      // The shift roster. Its per-departure coverage table is gone — crew
      // gaps are Today's, and reach this page as one summary line
      // (ADR 20260806-staffing-is-the-shift-roster) — so this capture is
      // deliberately shorter than the baseline it replaces.
      test(`the shift roster renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/staffing");
        await page.getByRole("heading", { name: "Staffing", level: 1 }).waitFor();
        await capture(page, "staffing", scheme);
      });

      // The fast walk-in flow: pick today's boat, then search or hand-enter
      // a diver — no trip page detour, no required email at the counter.
      test(`the walk-in counter renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in/walk-in");
        await page.getByRole("heading", { name: "Walk-in", level: 1 }).waitFor();
        await capture(page, "check-in-walk-in", scheme);
      });

      // The global Add-booking door, both halves: the departure picker with
      // seats-left on every row, and the diver step once a boat is chosen
      // (returning-diver search + hand entry). Two captures and now two tests —
      // the picker and the diver form never share a screen, so one shot would
      // leave half the surface with no baseline at all, and one *test* would
      // let a broken picker take the diver form's baseline with it.
      test(`the Add-booking departure picker renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        await capture(page, "booking-new", scheme);
      });

      test(`the Add-booking diver step renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        await page
          .getByRole("link", { name: /seats? left/ })
          .first()
          .click();
        await page.waitForURL(/\/bookings\/new\/[^/?]+$/);
        await page.getByRole("heading", { name: "New diver" }).waitFor();
        await capture(page, "booking-new-diver", scheme);
      });

      // The staff schedule as a builder: departures grouped by day, each row
      // carrying its crew and one quiet "⋯" disclosure for move/copy/remove.
      test(`the schedule board renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await capture(page, "schedule-builder", scheme);
      });

      // The add-a-departure form as a shop meets it all week: the quick path,
      // which the board only ever shows as a button — every field a departure
      // is born with, price included, with the rare half collapsed behind
      // "More options".
      test(`the add-a-departure panel renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await page.getByRole("link", { name: "Add a departure", exact: true }).click();
        // Its two selects fetch their options when the panel opens; wait for
        // the placeholder option to go, so the shot is never of "Loading…".
        await page
          .locator('select[name="courseId"] option[disabled]')
          .waitFor({ state: "detached" });
        await capture(page, "schedule-builder-add", scheme);
      });

      // The same panel at full depth — everything `/trips/new` used to be, now
      // disclosed inline (ADR 20260806-one-trip-create-form). This is the tall
      // one, and the only baseline that can catch the expanded form's own
      // rhythm: the dive-plan block, the two bordered fieldsets, and the single
      // submit that still ends it.
      test(`the expanded add-a-departure panel renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/schedule/board?add=full");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await page.getByRole("button", { name: "Fewer options" }).waitFor();
        await page
          .locator('select[name="courseId"] option[disabled]')
          .waitFor({ state: "detached" });
        await capture(page, "schedule-builder-add-full", scheme);
      });

      // The repeating-trip panel on a trip's own page. Built through the add
      // panel rather than seeded, because putting a standing charter into the
      // demo seed would move a dozen unrelated baselines (the board, the public
      // schedule, Today, the monthly report) for one section's sake. Per-test
      // reset makes the write safe, and the frozen clock makes the dates it
      // generates stable.
      test(`the repeating-trip panel renders true to the design (${scheme})`, async ({ page }) => {
        const title = "Standing Saturday charter";
        await page.goto("/shop/blue-mantis/schedule/board?add=full");
        await page.getByLabel("What is it").fill(title);
        await page.getByLabel("Date").fill(daysFromNow(4));
        await page.getByLabel("Departs").fill("08:00");
        await page.getByLabel("Returns").fill("11:00");
        await page.getByLabel("How often").selectOption("1");
        await page.getByRole("button", { name: "Put it on the board" }).click();
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await openTripFromBoard(page, title);
        await page.getByRole("heading", { name: "Repeating trip" }).waitFor();
        await capture(page, "trip-repeating-panel", scheme);

        // And the cadence editor open — the weekday chips carrying the run's
        // real answer, which is the state the collapsed panel above can never
        // show. Same page, one click, so it costs a click rather than a build.
        await page.getByText("Change the days it runs").click();
        await page.getByRole("group", { name: "Repeats on" }).waitFor();
        await capture(page, "trip-repeating-cadence", scheme);
      });

      // The blow-out confirm — the one deliberate step between the captain's
      // word and cancelling live bookings (ADR 20260804-blowout-cascade).
      // Read-only: nothing is cancelled by rendering it.
      test(`the blow-out confirm page renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("heading", { level: 1, name: "Call a blow-out?" }).waitFor();
        await capture(page, "blowout-confirm", scheme);
      });

      // The cascade record — the surface a blow-out morning is worked from.
      // Calling the blow-out inside the test is safe (per-test reset) and
      // deterministic: the frozen clock pins calledAt, and with no email
      // provider in the fleet every row lands in the same "Not sent" state —
      // the honest fallback surface an unconfigured shop would really see.
      test(`the blow-out cascade record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("button", { name: "Call the blow-out" }).click();
        await page.getByRole("heading", { level: 1, name: "Blow-out cascade" }).waitFor();
        await page.getByRole("columnheader", { name: "Diver" }).waitFor();
        await capture(page, "blowout-cascade", scheme);
      });

      // The roster — the front desk's densest everyday surface.
      // Wait for the roster itself, not the skeleton: same race as the public
      // schedule, and the one that put a half-drawn loading state into the
      // divers-light baseline.
      test(`the diver roster renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("searchbox", { name: "Search divers" }).waitFor();
        await capture(page, "divers", scheme);
      });

      // The roster's one view that leaves the active list behind: where a
      // removed diver can be found and restored, once the undo toast is long
      // gone. The demo shop removes nobody, so this photographs the view's own
      // chrome — the chip row with "Removed" on it, the line saying what
      // removal means, and the way back out.
      test(`the removed-divers view renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers?filter=removed");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("link", { name: "Removed", exact: true }).waitFor();
        await capture(page, "divers-removed", scheme);
      });

      // One diver's full profile: certs, specialty cards, contact.
      test(`a diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma", "PS");
        await capture(page, "diver-profile", scheme);
      });

      // A diver holding a card past its shop refresher-due date: the
      // "refresher due" badge renders red and the card no longer counts as
      // valid — the safety-relevant state (H-08: cards don't expire).
      test(`a diver with a refresher-due card renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Yusuf", "Yusuf Demir", "YD");
        await capture(page, "diver-profile-expired", scheme);
      });

      // The migrated diver, and every surface that has to say so. Her level
      // card reads verified with an "imported" provenance chip and a one-tap
      // "Confirm card" nudge (ADR 20260724-import-verified-cards), and her
      // shop history carries the visits that came across from the old system
      // (ADR 20260725-import-prior-visits) — imported-marked, unlinked, with a
      // cancelled booking struck through so it can't be read as a dive. This
      // page is where a spreadsheet cell either looks like evidence or looks
      // like what it is, so it is worth a baseline in both schemes.
      test(`an imported diver's record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Hana", "Hana Kobayashi", "HK");
        await capture(page, "diver-profile-imported", scheme);
      });

      /**
       * A diver who has actually paid for something. None of the three
       * profiles above carries a single order row — verified against the
       * seed, not assumed — so `PaymentsSection` had only ever been
       * photographed empty: no payment rows, no refund controls, no status
       * pills. Talia Rosen is the seed's heaviest payer, so this is the
       * widest version of the section.
       *
       * Deliberately a fourth capture rather than a repoint of
       * `diver-profile`: Priya's profile is the baseline for the *other*
       * states on that page, and moving it would trade one blind spot for
       * another.
       *
       * What this still does NOT cover, and why: the `formatMoneyCents` line
       * in `PaymentsSection` renders only for an order with
       * `bookingId === null` — a standalone shop payment. Every seeded order
       * is generated from a booking, so that branch is unreachable from the
       * demo data and no diver profile can capture it. It stays covered by
       * `PaymentsSection.test.tsx` alone. Seeding a standalone order would
       * fix that, but it also moves the reports and orders baselines and is a
       * demo-data change, so it belongs in its own commit rather than
       * smuggled into a coverage one.
       */
      test(`a paying diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Talia", "Talia Rosen", "TR");
        // Still resolves after the reorder — Payments moved from seventh to
        // fourth, but the section (and its heading) is the same one.
        await page.getByRole("heading", { name: "Payments" }).waitFor();
        await capture(page, "diver-profile-payments", scheme);
      });

      // The seeded reef trip's four surfaces — Overview (what the dive is),
      // Guests (who is attending), Manifest (the day-of boarding + roll call),
      // and Prep (the morning packing list). They share a layout that streams a
      // skeleton while the page's data loads, so every capture waits for real
      // content — never the loading fallback — before shooting. One test each:
      // they used to be four consecutive stops on one tour, which meant a
      // renamed heading on Overview cost the manifest its baseline too.
      test(`a trip's Overview renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        await capture(page, "trip-manage", scheme);
      });

      test(`a trip's Guests roster renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Guests");
        await page.getByRole("heading", { name: /Divers/ }).waitFor();
        await capture(page, "trip-guests", scheme);
      });

      test(`a trip's manifest renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        // The offline safety copy now saves itself in the background on
        // mount; wait for that to settle (the offline-roll-call link only
        // renders once saved) so the capture isn't racing that async write.
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        // The Web Push opt-in (ADR 20260804-manifest-web-push) sits in the same
        // card and decides what to render *after* mount — it reads
        // navigator/window for platform support, so the server render is empty.
        // Waiting for it keeps the capture from racing that resolution and
        // banking a baseline with the section half-present.
        await page.getByRole("heading", { name: "Wake this phone" }).waitFor();
        await capture(page, "manifest", scheme);
      });

      // The incident-ready export: the hand-to-authorities document of the
      // departure's recorded facts (roster with roll-call state, evidence and
      // waiver status, timeline, integrity code). Captured on the seeded reef
      // trip before any roll call, so the baseline shows the stated-absence
      // rendering — "Awaiting" cells, an explicitly empty timeline — which is
      // exactly the state that must never read as a blank on this document.
      test(`a trip's incident-ready export renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        const tripPath = new URL(page.url()).pathname;
        await page.goto(`${tripPath}/incident-export`);
        await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
        await capture(page, "incident-export", scheme);
      });

      // Blue Mantis fills nitrox, so the Tanks tile grid is at its full
      // Total/Air/Nitrox width; the collapsed single-tile layout for a shop that
      // doesn't is its own test below.
      test(`a trip's prep list renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Prep");
        await page.getByRole("heading", { name: "Tanks" }).waitFor();
        await capture(page, "prep", scheme);
      });

      // The offline shell's list view — every trip currently saved on this
      // device, reachable at dive.day root as well as `/offline-manifest`
      // directly (see ADR 20260726-shopwide-offline-manifest-priming). Visiting
      // the manifest is what puts a trip in it, so this test walks there first.
      test(`the offline manifest list renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the offline shell.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        await page.goto("/offline-manifest");
        await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
        await capture(page, "offline-manifest-list", scheme);
      });

      // The offline fallback a captain lands on after a failed reload with
      // no snapshot saved — the entire safety surface in that moment, so it
      // gets its own baseline rather than relying on the roll-call text
      // assertion in e2e/manifest.spec.ts to catch a styling regression.
      // Staff pages prime a device copy in the background, so clear IndexedDB
      // immediately before the visit to reproduce the truly-empty state (e.g.
      // storage eviction) rather than assuming a fresh context is enough.
      test(`the empty offline manifest renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // The shop-wide primer (OfflineManifestAutoSave) starts a fetch →
        // purge → save-all round on every staff page mount, and its parallel
        // saves can land *after* the deleteDatabase below finishes — the
        // store quietly refills and the empty heading never renders (caught
        // as a 164s timeout on CI shard 2, run 31075399016). Cut the race at
        // the harness boundary: with the upcoming-manifests feed blocked
        // from the first navigation, no round ever writes, and the delete
        // stays as defence against any other writer.
        await page.route("**/api/offline-manifests/upcoming", (route) => route.abort());
        await openReefTrip(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
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
      });

      /**
       * The discard notice: roll call a crew member recorded offline that never
       * reached DiveDay, on a saved copy the store finally deleted for passing
       * `OFFLINE_MANIFEST_PENDING_GRACE_MS` — 28 days past its own expiry — with
       * that evidence still queued on it (security review 2026-08-06, F3).
       *
       * It earns a baseline because of *where* it lands and *when*. The delete
       * almost always happens with no page open (the worker's push refresh, the
       * staff layout's auto-save), so this danger-toned panel is the first and
       * only place a human is told; and the surface it appears on is a shared
       * boat tablet at the dock, in the minute a captain is counting heads. It
       * is also the one thing on this shell that reconnecting cannot undo.
       *
       * Captured on the **list** branch, once. The notice is a single component
       * rendered identically by all three branches (list, the trip empty state,
       * and the roster) — the only difference is which sibling precedes it — so
       * a second and third frame would cost eight more PNGs to photograph the
       * same markup at a different vertical offset. The list is where a tablet
       * picked up at the dock opens.
       *
       * Left on Blue Mantis's own record rather than a foreign shop's: the
       * ceiling is shop-agnostic, and keeping it on the seeded shop means every
       * word in the notice is a seeded value rather than an invented one.
       */
      test(`the offline manifest's discard notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        // Two divers' worth, so the plural of both strings is what is banked —
        // one lost tap is the rarer shape, and it is the narrower one to lay out.
        await rewriteSavedOfflineRecord(page, tripId, {
          expiresAt: PAST_PENDING_GRACE,
          pendingRollCalls: 2,
        });

        // The tenant lookup stays refused for the rest of this test (see
        // `savedOfflineRecordFor`), and here that is what makes the panel
        // deterministic rather than merely still. A tenant the shell *can*
        // resolve starts a cross-shop purge, and that purge reads every saved
        // record through `loadOfflineManifest` — the same function the list
        // branch is already reading them through. Both would reach this record
        // before either deleted it, both would append a notice for it, and the
        // panel would photograph one row or two depending on which finished
        // first. One reader, one row.
        await page.reload();
        // The notice itself, not the list heading: the discard is written while
        // the store is being read and the panel arrives after the rows, so the
        // heading resolves against a page that has not yet been told anything
        // was lost. `role="alert"` is the panel's own element — waiting on the
        // "Got it" button would equally prove it mounted, but this is the
        // sentence a regression would move.
        await page
          .getByRole("alert")
          .filter({ hasText: "Roll call that never sent has been removed" })
          .waitFor();
        await capture(page, "offline-manifest-discarded", scheme);
      });

      /**
       * `?trip=<id>` for a record the cross-shop purge has just deleted out from
       * under the captain reading it — a different shop signed in on this
       * tablet, so this trip's saved copy is gone and roll call for it has to be
       * recorded on that shop's own live manifest (security review 2026-08-06,
       * F5).
       *
       * The point of the state is the *copy*: before this it repainted to the
       * ordinary "Nothing saved on this phone yet", which is the one sentence
       * the captain already knows is false — they were looking at the roster a
       * moment ago. `offline-manifest-empty` is the baseline for that ordinary
       * sentence and stays pointed at it; this is its own frame because the two
       * render the same layout with different words, and a regression that
       * collapsed one into the other would move nothing on that one.
       *
       * Reached the way it happens on a boat, in order: no signal, so the shell
       * paints the saved roster; then signal, so the purge runs and the record
       * goes. That order is the whole test — the state needs the roster to have
       * been on screen first (it is what tells the purge whose copy it was
       * removing), so a purge that wins the race to the store instead produces
       * the plain empty state and photographs the wrong page.
       */
      test(`an offline copy removed by another shop renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { shop: OTHER_SHOP });

        // No signal for the first paint — the tenant lookup is still refused
        // from `savedOfflineRecordFor`, so the purge declines to run and the
        // saved roster paints from storage exactly as it does on the dock.
        // Cutting the whole context offline would say the same thing, and would
        // also put this navigation through the service worker's cached shell:
        // a second thing to prime and a second thing to be flaky.
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Before departure roll call" }).waitFor();

        // Signal returns. The shell re-runs its purge on `online` — the same
        // event the fixture's own `setOffline(false)` dispatches — and this time
        // the tenant answers, so the foreign record is deleted and the branch
        // repaints saying why.
        await page.unroute(IDENTITY_ROUTE);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page.getByRole("heading", { name: "That saved copy has been removed" }).waitFor();
        await capture(page, "offline-manifest-removed-other-shop", scheme);
      });

      // Shop settings, where staff set the rental catalog and its prices.
      test(`shop settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Rental prices" }).waitFor();
        // One row open in the capture, so the baseline shows the disclosure's
        // open-form treatment as well as the at-rest directory.
        await openSettingsRow(page, "Rental prices");
        await capture(page, "settings-payments", scheme);
      });

      // Where a shop connects its own WhatsApp Business number (ADR
      // 20260802-whatsapp-embedded-signup). The fleet configures no META_*
      // credentials, so this captures the coming-soon state — which is what
      // every shop sees today, and where all of this surface's copy lives.
      test(`WhatsApp settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/whatsapp");
        await page.getByRole("heading", { name: "How connecting works" }).waitFor();
        await capture(page, "settings-whatsapp", scheme);
      });

      /**
       * The two orders surfaces — the densest money screens in the app, and
       * until recently the only ones with no baseline at all. That gap was found
       * the honest way: the shop-currency change (ADR 20260731-shop-currency)
       * rewrote how every amount here is formatted, and the visual suite
       * reported nothing, because it had never looked. A surface whose whole
       * job is stating amounts is exactly where a silent pass is worthless.
       *
       * Both render the *order row's own* stored currency, not the shop's
       * current setting: a settled amount is evidence and is never
       * re-denominated by a later settings change.
       */
      test(`the orders list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
        // The money column itself, not just the heading — the table streams in
        // and a capture taken on the header alone can bank an empty tbody.
        await page.locator("tbody tr").filter({ visible: true }).first().waitFor();
        await capture(page, "orders", scheme);
      });

      // One order in full: the total, and the per-line-item amounts that a
      // literal `$` and a hardcoded `/ 100` used to compose by hand.
      test(`an order's detail renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        await page.locator("tbody tr").filter({ visible: true }).first().waitFor();
        await page
          .locator('tbody tr a[href*="/orders/"]')
          .filter({ visible: true })
          .first()
          .click();
        // Not "Front desk": the orders list this just navigated from carries
        // the identical eyebrow text, already on screen, so waiting on it
        // resolves instantly against the *old* page instead of the new one —
        // capture() then fires while orders/[id] is still behind its own
        // loading.tsx skeleton. "Back to diver" only exists on the detail page.
        await page.getByRole("link", { name: "Back to diver" }).waitFor();
        await capture(page, "order-detail", scheme);
      });

      /**
       * The one data-out surface: the "your data is yours" promise, concrete,
       * in both halves (ADR 20260806-one-data-out-surface) — the bundle you
       * would download now, and the weekly copy already landing in storage the
       * shop owns. The `settings-backup` capture retired into this one; the
       * seed ships blue-mantis configured with six weekly deliveries and one
       * failed week, so the backup half still photographs doing its real job:
       * proving where the data went and naming the week it didn't.
       */
      test(`the data-export page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/export");
        await page.getByRole("heading", { name: "Data export" }).waitFor();
        await page.getByRole("heading", { name: "Delivery history" }).waitFor();
        // The history rows, not just the heading — the table is half the
        // surface, and a capture taken on the heading alone banks an empty one.
        await page.getByRole("cell", { name: "Failed" }).waitFor();
        await capture(page, "settings-export", scheme);
      });

      // The import surface: the honesty table stating what does and doesn't
      // come across, before any file is chosen.
      test(`the data-import page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/import");
        await page.getByRole("heading", { name: "What comes across" }).waitFor();
        await capture(page, "settings-import", scheme);
      });

      // The embed settings page (docs ADR 20260726-schedule-embed). The fleet
      // now runs against a configured non-loopback APP_HOST (E2E_APP_HOST in
      // e2e/servers.ts), so this baseline is the generated-snippet state a
      // real deploy shows — the two SnippetField boxes and the copy buttons —
      // rather than the "hosting isn't configured" warning it was stuck on
      // while publicAppUrl() returned null here.
      test(`the embed settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/embed");
        await page.getByRole("heading", { name: "Website embed" }).waitFor();
        // The snippets are a Client Component; wait for a control it only
        // renders once mounted before shooting.
        await page.getByRole("button", { name: "Copy" }).first().waitFor();
        await capture(page, "settings-embed", scheme);
      });

      // The team surface: inviting staff and the current roster, each card's
      // Enable/Disable/Delete immediate-action buttons and its role
      // checkboxes batched into the page's single "Save changes".
      test(`the team settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        await capture(page, "settings-team", scheme);
      });

      // Calendar subscriptions, in the un-subscribed state: both scopes
      // offered to an owner, neither yet minted. Deliberately not the
      // just-minted state — that panel shows a live feed token, which is
      // different on every run and would never match a baseline.
      test(`the calendar settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        // Wait on the panel's own button, not the page's <h1>: the panels are
        // Client Components, and per this file's rule a server-rendered
        // heading resolves before the interesting part has mounted.
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await capture(page, "settings-calendar", scheme);
      });

      // The courses catalog: the agency tab strip that replaced the per-row
      // PADI/SSI pill, the list in progression order rather than alphabetical,
      // and the three row controls — schedule a session, the eye visibility
      // toggle, the link out to the public page.
      test(`the staff course catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "courses-list", scheme);
      });

      // One agency's half of the catalog: the selected tab, and a shorter list
      // that still reads in progression order.
      test(`the staff course catalog filtered by agency renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/courses?agency=ssi");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "courses-list-agency", scheme);
      });

      // A course's edit page: the Day by day section's per-day controls
      // (start/end time, time note) over a one-item-per-line textarea, and the
      // single Save control at the foot — no Hide/Show or Preview beside it
      // (ADR 20260805-remove-certification-paths shipped alongside that trim).
      test(`the course editor renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        // "Day by day" is a server-rendered <legend>, so it is on screen before
        // DayByDayEditor (a Client Component) mounts — waiting on it let the
        // capture land mid-mount. Wait for a control the editor itself renders.
        await page.getByText("Day by day").waitFor();
        await page.getByLabel("Day 1 — what happens").waitFor();
        await capture(page, "course-edit", scheme);
      });

      // Owner reporting: "how's my month" over the seeded back-fill — the KPI
      // row and the per-trip breakdown that answer the buyer's revenue question.
      test(`owner reports render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("heading", { level: 1, name: "How's your month" }).waitFor();
        await capture(page, "reports", scheme);
      });

      // The waiver's two tabs (task 155): Template is the release editor …
      test(`the waiver template renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/waivers");
        await page.getByRole("heading", { level: 1, name: "Waiver template" }).waitFor();
        await capture(page, "staff-waivers", scheme);
      });

      // … and Signatures is the signed-record evidence audit, paginated
      // (`listWaiverIntegrityAudit`, `WAIVER_INTEGRITY_PAGE_SIZE`) so the demo
      // shop's 150+ signed records render as one page under the shared pager
      // rather than a silent truncation notice.
      //
      // Reached by URL rather than by clicking the "Waiver sections" sub-nav
      // the way this used to, now that it no longer follows the Template
      // capture inside one test: the page renders identically either way, and
      // the sub-nav click stays exercised by e2e/waivers.spec.ts.
      test(`the waiver signature audit renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/waivers/signatures");
        await page.getByRole("heading", { level: 1, name: "Signatures" }).waitFor();
        await page.getByRole("navigation", { name: "Pages" }).waitFor();
        await capture(page, "staff-waivers-signatures", scheme);
      });

      // The moderation queue: published reviews, and the "waiting on you"
      // card a written review sits in until staff release it
      // (docs ADR 20260729-verified-diver-reviews). Waiting on the bulk
      // control specifically, not just the heading: "Publish selected" and
      // the per-row tick boxes come from a client provider, and a capture
      // taken before it mounts photographs a list with no checkboxes in it.
      test(`the review moderation queue renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "What divers said" }).waitFor();
        await page.getByRole("button", { name: "Publish selected" }).waitFor();
        await capture(page, "staff-reviews", scheme);
      });

      // Shop-wide discount codes: the create form plus the seeded codes with
      // their windows and redemption counts
      // (docs ADR 20260729-shop-promo-codes).
      test(`the discount codes page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/promos");
        await page.getByRole("heading", { level: 1, name: "Discounts a diver can type" }).waitFor();
        await capture(page, "staff-promos", scheme);
      });

      // H-13: a Night-trip seat booked through a shared inbox under a name that
      // doesn't match the person on file shows the fail-closed "Confirm
      // identity" affordance and blocker until staff vouch for it — a
      // safety-critical state worth a baseline.
      test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Guests");
        await page.getByText("Identity unconfirmed").first().waitFor();
        await capture(page, "trip-guests-identity", scheme);
      });

      // A shop that doesn't fill nitrox (or a trip with no live request left
      // on it once nitrox is off) sees Total and Air collapse into a single
      // tile — there's nothing for a second number to distinguish. Toggling
      // the shared demo shop's rental catalog is contained here and reverted
      // regardless of pass/fail, matching the pattern in e2e/nitrox.spec.ts.
      test(`the prep page's tank tile collapses with nitrox off (${scheme})`, async ({ page }) => {
        // Two settings round-trips bracket the capture, plus board → trip →
        // Prep in between.
        test.setTimeout(FLOW_TIMEOUT_MS);
        try {
          await page.goto("/shop/blue-mantis/settings");
          await openSettingsRow(page, "What we rent");
          await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
          await page.getByRole("button", { name: "Save rental catalog" }).click();
          await page.getByText("Rental catalog saved.").waitFor();

          await openReefTrip(page);
          await openTripTab(page, "Prep");
          await page.getByRole("heading", { name: "Tanks" }).waitFor();
          await capture(page, "prep-no-nitrox", scheme);
        } finally {
          await page.goto("/shop/blue-mantis/settings");
          await openSettingsRow(page, "What we rent");
          await page.getByRole("checkbox", { name: "Nitrox fills" }).check();
          await page.getByRole("button", { name: "Save rental catalog" }).click();
          await page.getByText("Rental catalog saved.").waitFor();
        }
      });

      /**
       * DOM-H3. After a dive, the only control that isn't "Boarded" means
       * **did not return to the boat** — a different state from the dock's
       * "never left", with its own wording, its own danger-toned row, and a
       * checkpoint that stays open. Nothing in the seed reaches it, and the
       * departure capture above cannot show it, so it gets its own baseline:
       * this is the screen a captain reads when someone is still in the water,
       * and it used to be pixel-identical to a settled "Not boarded ☑️" row.
       * Its own test so the roll-call write is contained — the per-test DB
       * reset (e2e/fixtures.ts) puts it back.
       */
      test(`the manifest's after-dive missing-diver state renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, a checkpoint switch, and a roll-call write
        // before the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        // Same background-save settle the departure capture waits on, so this
        // isn't racing that async write either.
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // Scoped to the diver list: the crew section above it carries controls
        // with the same words, for a crew member rather than a diver.
        const markNotBack = page
          .locator("#roll-call-list")
          .getByRole("button", { name: "Mark not back aboard" })
          .first();
        await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await markNotBack.click();
        await expect(
          page
            .locator("#roll-call-list")
            .getByRole("button", { name: "Not back aboard", exact: true })
            .first(),
        ).toBeVisible();
        await capture(page, "manifest-not-back-aboard", scheme);
      });

      /**
       * A diver row with both of its disclosures open — "Contact & gear" and
       * "Add a note". The `manifest` capture above photographs nine rows at
       * rest, which proves nothing about what a tap reveals, and this is where
       * the row's geometry is: the two summaries share one line and each panel
       * opens down its own grid column, so an open panel must not move its
       * neighbour, and neither summary may shift under the finger that opened
       * it. It is also the only baseline carrying the emergency contact, the
       * rental list, and the note field's save line.
       */
      test(`a diver row's open disclosures render true to the design (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        const row = page.locator("#roll-call-list li").first();
        // By position, not by label: the facts summary reads "Contact & gear"
        // or "Contact, gear & medical" depending on what that diver has on
        // file, and "Contact" also matches the "Emergency contact" heading the
        // panel reveals (twice — the print-only copy is in the DOM too).
        const summaries = row.locator("summary");
        await summaries.nth(0).click();
        await summaries.nth(1).click();
        // Both panels painted before the shot: the facts grid renders its
        // emergency-contact heading, the note panel its input.
        // Scoped to the disclosure: the print-only copy of the same facts is
        // in the DOM on every row, carrying the identical heading.
        await expect(row.locator("details").first().getByText("Emergency contact")).toBeVisible();
        await expect(row.getByRole("textbox", { name: "Note" })).toBeVisible();
        // The pointer is left on the summary by the click above, which would
        // bank a hover-underlined label into the baseline.
        await page.mouse.move(0, 0);
        await capture(page, "manifest-row-disclosures", scheme);
      });

      /**
       * A split buddy team after a dive (ADR 20260804-buddy-teams): Tom is
       * recorded back aboard and his seeded teammate Lena has no result yet, so
       * his row carries the danger chip and the checkpoint panel adds the
       * "1 buddy team is split" line. The seed carries the teams but no
       * roll-call events (they would open head-count gaps on Today), so the
       * divergent state is driven here and the per-test DB reset puts it
       * back — the same pattern as the missing-diver capture above.
       */
      test(`the manifest's split buddy team renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, a checkpoint switch, and a roll-call
        // write before the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("link", { name: "Open offline roll call" }).waitFor();
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // Anchored on the row's own <h3>: a bare `li hasText "Tom Okafor"`
        // also matches Lena's row via her "Buddy team: Tom Okafor" chip (see
        // the same note in e2e/buddy-pairs.spec.ts).
        const tomRow = page
          .locator("#roll-call-list li")
          .filter({ has: page.getByRole("heading", { name: "Tom Okafor", exact: true }) });
        const boardTom = tomRow.getByRole("button", { name: "Mark boarded" });
        await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await boardTom.click();
        await expect(
          tomRow.getByText("Buddy team: Lena Fischer · Someone unaccounted for"),
        ).toBeVisible();
        await capture(page, "manifest-buddy-divergence", scheme);
      });

      /**
       * The buddy-teams panel itself — the team builder (ADR
       * 20260804-buddy-teams). Worth its own capture because it is where the
       * model became visible: a team of any size, a crew member marked as crew
       * on the divemaster-led trio, per-member removal, and a checkbox builder
       * in place of the two dropdowns that could only ever express a pair. The
       * whole panel is `print:hidden`, so no other capture covers it.
       */
      test(`the manifest's buddy-team builder renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        const panel = page.locator("section", {
          has: page.getByRole("heading", { name: "Buddy teams" }),
        });
        // The panel rests collapsed behind its summary line — the capture is
        // of the panel itself, so open it the way a staffer would.
        await page.getByRole("heading", { name: "Buddy teams" }).click();
        await expect(panel.getByText("Keiko Tanaka (crew)")).toBeVisible();
        await panel.scrollIntoViewIfNeeded();
        await capture(page, "manifest-buddy-teams-panel", scheme);
      });

      // H-08: a site deeper than a diver's certification trains for. Warning
      // tone and *outside* the red blocker list, because it never blocks — an
      // instructor may be keeping that diver shallower on purpose. Nothing in
      // the seed reaches this state (every seeded site sits within its divers'
      // ceilings), so the depth is raised for the capture and put back after,
      // matching the nitrox pattern above.
      test(`the roster's depth warning renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Two full briefing saves bracket the capture — set the depth, walk
        // board → trip → Guests, shoot, then put the depth back in a `finally`
        // — so this is six navigations and two form round-trips. Measured
        // failing at HEAD *and* on `main` at one worker, so it was never a
        // contention problem: the budget was simply never sized for what the
        // test does. A flat 60s when it was written, which stopped tracking the
        // budgets the moment they were derived — and by now *lowered* this test
        // below the plain-capture ceiling it was raised above. Same allowance
        // as every other flow capture here.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const setDepth = async (meters: string) => {
          await page.goto("/shop/blue-mantis/dive-sites");
          await page.getByRole("link", { name: "Molasses Reef" }).first().click();
          await page.waitForURL(/\/dive-sites\//);
          // The seeded briefing's photo URLs can't be re-ingested from the e2e
          // sandbox, so leaving them in refuses the save with the image error
          // (returned to the form now, not a `?error=images` redirect).
          await page.getByLabel(/Site photo URLs/).fill("");
          await page.getByLabel(/Maximum depth/).fill(meters);
          await page.getByRole("button", { name: "Save dive site" }).click();
          await page.getByText("Dive site saved.").waitFor();
        };
        try {
          await setDepth("32");
          await openReefTrip(page);
          await openTripTab(page, "Guests");
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
        // Board → trip → Guests, then an add and a delete round-trip.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Guests");
        const row = page.locator("#roster li").filter({ visible: true }).first();
        // A row with no notes labels the disclosure "Add a private note"; once
        // one exists it reads "Private staff notes (N)" — match either state.
        await row
          .getByText(/Private staff notes|Add a private note/)
          .filter({ visible: true })
          .click();
        await row
          .getByLabel("Add a note only staff can see")
          .fill("Visual regression seed note for the undo toast.");
        await row.getByRole("button", { name: "Add private note" }).click();
        await page.getByText("Private staff note added.").waitFor();

        await row
          .getByText(/Private staff notes|Add a private note/)
          .filter({ visible: true })
          .click();
        await row.getByRole("button", { name: "Delete" }).click();
        await page.getByText("Private note deleted.").waitFor();
        await capture(page, "trip-guests-note-undo", scheme);
      });

      /**
       * **The boat's own cert gate, refused, on the surface staff work from**
       * (ADR 20260803-trip-admission-at-booking; the flow itself is
       * e2e/trip-admission.spec.ts).
       *
       * Two captures because the banner says two structurally different things,
       * and until now neither had a baseline — a refusal is a *state*, not a
       * route, so `trip-guests` could never show it. A level refusal names the
       * rung the charter wants and the rung the diver stands on, and offers no
       * card to add; a card refusal names the missing specialty and says there
       * is none on the record. One sentence pattern regressing into the other
       * is exactly the kind of change that reads as fine in a diff and wrong on
       * the screen.
       *
       * The seeded scenarios come from `src/db/seed-cert-gates.ts`, whose whole
       * point is that each of these boats can be refused for exactly one reason.
       */
      test(`the roster's level refusal renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A board crawl to a day-31 departure, then a real seating attempt.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);
        // Diego Alvarez is on file with a verified Open Water card and nothing
        // above it, so the refusal can only be about the rung.
        await page.goto(`/shop/blue-mantis/trips/${tripId}/guests?diverq=Diego+Alvarez`);
        await page.getByRole("button", { name: "Add Diego Alvarez to the trip" }).click();
        await page.getByText("This charter requires Advanced Open Water.").waitFor();
        await capture(page, "trip-guests-refusal-level", scheme);
      });

      test(`the roster's missing-card refusal renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", DEEP_CHARTER);
        // Odile Marchand holds a verified Instructor card — the top rung — and
        // no specialty card at all, so nothing about her level can explain it.
        await page.goto(`/shop/blue-mantis/trips/${tripId}/guests?diverq=Odile+Marchand`);
        await page.getByRole("button", { name: "Add Odile Marchand to the trip" }).click();
        await page.getByText("This charter requires a Deep card.").waitFor();
        await capture(page, "trip-guests-refusal-card", scheme);
      });

      /**
       * A course session's Readiness requirements, stating the gate its *dive
       * site* carries and saying out loud that it never blocks enrolment (the
       * carve-out in ADR 20260803-trip-admission-at-booking, amended after the
       * dive-domain-expert review). `trip-manage` above is a plain charter with
       * an editable requirements form; this is the frozen variant, where the
       * rules come from the course and the site and there is no form at all —
       * a different section, on a page whose baseline could never show it.
       */
      test(`a course session's requirements render true to the design (${scheme})`, async ({
        page,
      }) => {
        // A board crawl out to the day-29 session, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", AOW_COURSE);
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await page
          .locator("section")
          .filter({ has: page.getByRole("heading", { name: "Readiness requirements" }) })
          .getByText(/never blocks? enrolment/)
          .first()
          .waitFor();
        await capture(page, "trip-manage-course-requirements", scheme);
      });

      // The shop's own dive-site library, which had no baseline at all until
      // it gained a search band and a pager.
      test(`the dive-site library renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
        await capture(page, "dive-sites-library", scheme);
      });

      // A site's own briefing form, which is where the route a shop draws is
      // drawn. Captured on a seeded site that already has one, so the frame
      // holds the map, the curve, and its start/finish dots rather than the
      // empty state — the thing worth having a baseline of. The satellite
      // embed is a third-party iframe and renders nothing deterministic in
      // CI, which is exactly why the overlay is what this watches: the SVG is
      // ours and is drawn from the row.
      test(`the dive-site briefing form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("link", { name: "Molasses Reef" }).first().click();
        await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
        // The route's own caption box, which only renders once the editor has
        // mounted and read the coordinate fields beside it.
        await page.getByLabel("What the route is called").waitFor();
        await capture(page, "dive-site-edit", scheme);
      });

      // The front desk's invoice builder. It redirects to Divers for a shop
      // that can't take money, so mark the demo shop connected first:
      // /api/test/seed-stripe-account is a pure DB write that never calls
      // Stripe (same use as the recap tip section above), and no order is
      // created here — this is the empty form, which is the whole surface.
      // Its own test also keeps that connected-shop write off every other
      // capture: a connected shop changes what several staff surfaces render.
      test(`the invoice builder renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-stripe-account");
        await page.goto("/shop/blue-mantis/orders/new");
        await page.getByRole("heading", { level: 1, name: "New order" }).waitFor();
        await capture(page, "orders-new", scheme);
      });

      // DiveDay's published dive-site templates, each card stating the
      // version it would import into the shop's own library. It is the
      // library's own catalog *view* rather than a route of its own
      // (ADR 20260806-dive-site-catalog-is-a-view), so this navigates through
      // the redirect the old URL still serves and keeps the
      // `dive-sites-catalog` capture name.
      test(`the dive-site catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites/catalog");
        await page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }).waitFor();
        await capture(page, "dive-sites-catalog", scheme);
      });

      /**
       * The two staff overlays and the app's not-found backstop — three
       * surfaces that are *states*, not routes, and so had no baseline at all.
       *
       * Both overlays are hosted on `/settings/calendar` rather than Today.
       * They are `position: fixed`, and a `fullPage` shot renders a fixed
       * element once, at the top, above however much page happens to sit
       * underneath — so hosting them on the tall dashboard would bank a
       * baseline that re-diffs every time Today's queue changes, for a change
       * that has nothing to do with the overlay. The calendar settings page is
       * the shortest read-only staff surface there is (two panels, no seeded
       * rows, nothing minted until a button is pressed), so almost all of each
       * of these images is the overlay itself.
       *
       * One test each, and each closes its overlay before finishing: an overlay
       * left open leaks into whatever the same page does next, which is the
       * hazard that used to make these one sequential test.
       */
      test(`the keyboard shortcut sheet renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        // The panels are Client Components; wait for a control one of them only
        // renders once mounted, not for the server-rendered <h1> above them —
        // the same wait `settings-calendar` makes.
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        // The cheat sheet `?` opens (e2e/keyboard-shortcuts.spec.ts): every
        // `g`-sequence this viewer's role can reach, read off the one
        // destination registry the nav and the palette also read.
        await page.keyboard.press("?");
        const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
        await sheet.waitFor();
        await capture(page, "shortcut-sheet", scheme);
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      });

      // The command palette on open, with no query typed: a Client Component,
      // so wait for the control it only renders once mounted *and* focused
      // rather than for anything the server rendered. An empty query lists
      // every "Go to" destination the registry offers this role — no search
      // request, nothing debounced, nothing that could land differently
      // between runs.
      test(`the command palette renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await capture(page, "command-palette", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      // The app-wide `notFound()` backstop (src/app/not-found.tsx) — a stale
      // email link or a typo'd URL. Captured under a staff session because
      // that is who reaches it on a `/shop` URL; signed out the same address
      // is an auth redirect, never this page.
      test(`the not-found page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/no-such-page");
        await page.getByRole("heading", { level: 1, name: "We couldn’t find that page" }).waitFor();
        await capture(page, "not-found", scheme);
      });
    });
  });
}

/**
 * The capture harness's own escape hatch, exercised on purpose.
 *
 * `withRendererBound` exists for a stall that has never reproduced outside CI,
 * so without this nothing in any run ever takes the branch — the degrade could
 * rot into a `throw`, or the probe into a hang, and the first anyone would know
 * is the next red shard, which is precisely the failure it was written to
 * prevent. Shoots nothing, so it costs the baseline nothing.
 */
test.describe("capture harness", () => {
  test("a pass that never settles is bounded, reported, and degraded", async ({ page }) => {
    await page.goto("/");
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    let degraded: number;
    try {
      degraded = await withRendererBound(
        page,
        "a wait that never settles",
        1_000,
        // Never resolves — and is still pending when the test ends, which is
        // the other half of what this proves: `withRendererBound` must absorb
        // the rejection Playwright raises when it tears the context down,
        // rather than leaking it into whichever test runs next.
        //
        // The resolver is rooted on `globalThis` so V8 cannot collect the
        // promise. A `new Promise(() => {})` whose resolvers are referenced
        // nowhere is unreachable the moment it is created, and when Chromium
        // collects it Playwright rejects the evaluate with "Resulting promise
        // was garbage collected" — which `withRendererBound` then rethrows,
        // correctly, since a pass that *throws* is a broken page and must not
        // be swallowed. That made this test a race between GC and the 1s
        // budget, red whenever GC won. Rooting the resolver keeps it genuinely
        // pending, which is what the test means by "never settles"; nothing
        // ever calls it.
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              (globalThis as { __neverSettles?: (value: number) => void }).__neverSettles = resolve;
            }),
        ),
        -1,
      );
    } finally {
      console.warn = realWarn;
    }
    expect(degraded).toBe(-1);
    const reported = warnings.join("\n");
    expect(reported).toContain("did not return within 1000ms");
    // This page is perfectly healthy — only the promise above never settled —
    // so the probe has to be able to say so. A wedged renderer is the *other*
    // sentence, and telling them apart is the whole point of asking.
    expect(reported).toContain("the page is alive");
  });

  test("a pass that fails still throws, rather than degrading silently", async ({ page }) => {
    await page.goto("/");
    await expect(
      withRendererBound(
        page,
        "a wait that throws",
        10_000,
        page.evaluate(() => {
          throw new Error("boom");
        }),
        "degraded",
      ),
    ).rejects.toThrow("boom");
  });
});

/**
 * Print / Save-as-PDF surfaces. The manifest and the prep list are the two
 * pages staff physically print for the dock, and print gets a dedicated
 * rendering (globals.css `@media print`): monochrome, so a shop's black-and-
 * white printer isn't asked for muddy color, and padded, so content doesn't
 * slam into the paper edge. The interactive baselines above never exercise
 * that path. This block lives outside the light/dark loop on purpose — print
 * is scheme-independent — and runs at a US-Letter-ish width so the baseline
 * reflects paper rather than a 1280px browser window.
 *
 * One test per printed surface, same rule as the rest of the file: the manifest
 * failing to render must not cost the prep list its baseline.
 */
test.describe("print", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 816, height: 1056 } });

  // Reach the seeded reef trip the way staff do, then print its dock surfaces.
  // Navigating by link keeps these off any hard-coded trip id.
  test("the dock manifest prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/manifest`);
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await capturePrint(page, "manifest");
  });

  test("the dock prep list prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/prep`);
    await page.getByRole("heading", { name: "Tanks" }).waitFor();
    await capturePrint(page, "prep");
  });

  // The incident-ready export exists to be printed and handed over, so the
  // print rendering is the primary artifact, not a nice-to-have.
  test("the incident-ready export prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/incident-export`);
    await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
    await capturePrint(page, "incident-export");
  });
});
