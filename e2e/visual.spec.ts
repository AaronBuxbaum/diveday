import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { AFTER_STATE_TEST_IDS } from "../src/app/ready/[token]/_components/AfterState";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { OFFLINE_MANIFEST_PENDING_GRACE_MS } from "../src/lib/offline-manifest-store";
import {
  OFFLINE_MANIFEST_AGING_MS,
  OFFLINE_MANIFEST_RECORD_VERSION,
} from "../src/lib/offline-manifests";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  choosePartySize,
  daysFromNow,
  manifestRow,
  offlineCopySaved,
  openManifestPerson,
  openOnThisPhone,
  openRosterNotes,
  openSettingsRow,
  openThreadStep,
  openTripAbout,
  openTripFromBoard,
  openTripTab,
  seededTripId,
  threadStatus,
  waiverLinkFromResult,
} from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * Visual regression coverage. A hundred and sixty key surfaces × light/dark, each
 * captured at a phone and a desktop viewport — 640 screenshots per run (see
 * ADR 20260729-reg-suit-visual-regression). Keep this count in sync when
 * adding a surface; each `capture()` call costs 4 screenshots per CI run — 6
 * for a surface named in `TABLET_SURFACES`, which takes a third viewport.
 * `grep -c 'await capture(page,' e2e/visual.spec.ts` is the number — the prose
 * has drifted from it before (it read 48 while the grep said 56, 71 while the
 * grep said 72, 83 while the grep said 93, and 98 while the grep said 108), so
 * trust the grep and correct
 * the prose. The trailing comma in that pattern is load-bearing: without it the
 * grep also matches this very sentence and reads one high, which is how the
 * "correct the prose" instruction above ended up chasing a number that was
 * never right.
 *
 * Four more come from the `print` block at the bottom: the manifest, prep,
 * trip-packet, and departure-log pages as they render for the printer. Print
 * is its own concern, not a light/dark one — the `@media print` token override
 * collapses both schemes to one black-and-white palette — so each is captured
 * once, at a US-Letter width, via `capturePrint()`.
 *
 * `captureStickyFoot()` adds 4 more (one surface × light/dark × both widths),
 * and `TABLET_SURFACES` adds 10: five staff surfaces get a third, portrait
 * tablet width, at one screenshot per scheme rather than the usual two. That
 * brings the run to 658 screenshots — the tablet width is a 1.6% addition, not
 * the 50% a third viewport applied to every surface would have cost.
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
 * loses exactly its own PNGs — four, or six for a `TABLET_SURFACES` one —
 * every sibling is still shot in the same run,
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
 * **A portrait tablet — the device the shop is actually holding.**
 *
 * `VIEWPORTS` above is the standard responsive pair, and it is the right
 * default for a marketing page, a booking page and a diver's `/ready`. It is
 * the wrong device for the surfaces a dive shop works from: `/check-in` calls
 * itself "Counter mode", and a counter device is an iPad on a stand; the
 * manifest is read at the rail, often through a dry case, which is the whole
 * reason `glare-mode` exists in `globals.css` with its >=16px text and >=44px
 * targets.
 *
 * 768-1024px is also where Tailwind's `sm:`/`md:` breakpoints change a
 * layout's *shape* — where a two-column `FieldGrid` collapses, and where
 * `StaffTabBar`'s six-slot phone dock gives way to the header nav. Every one
 * of those transitions was unphotographed, so a regression there reached a
 * shop before it reached CI.
 *
 * Portrait rather than landscape because portrait is the harder layout and the
 * posture a stand holds. A crew member holding a phone sideways at the rail is
 * a real posture too; it is not photographed here, and should not be until
 * something other than a hunch says it needs to be.
 */
const TABLET_VIEWPORT = { width: 820, height: 1180 } as const;

/**
 * The capture names that get `TABLET_VIEWPORT` as a third width — **five, not
 * every surface in this file.**
 *
 * A third width applied everywhere is another 320 screenshots and the baseline
 * churn to match, and most routes have nothing new to say at 820px. So the
 * list is a constant rather than a global width: the cost is bounded, and
 * which surfaces earn it is a decision a reviewer can argue with in one place
 * instead of inferring from a diff.
 *
 * Why each one:
 *
 * - `check-in` — "Counter mode" by its own heading. The front desk is a
 *   tablet on a stand and nothing else.
 * - `manifest` — worked at the rail in a dry case; `glare-mode`'s whole
 *   premise is this device in this light.
 * - `schedule-builder` — a dense two-column board a shop keeps open on
 *   whatever is on the desk.
 * - `prep` — the same, the day before.
 * - `departure-log` — written up at the end of the day, on the device that
 *   was already out.
 *
 * Adding a name here costs two screenshots per run (one per scheme). Adding
 * one that no `capture()` call uses costs nothing and silently photographs
 * nothing, which is why `tabletSurfacesAreReal` below refuses it.
 */
const TABLET_SURFACES: ReadonlySet<string> = new Set([
  "check-in",
  "manifest",
  "schedule-builder",
  "prep",
  "departure-log",
  "departure-log-every-checkpoint",
]);

/**
 * A name in `TABLET_SURFACES` that no `capture()` call uses photographs
 * nothing and fails nothing: the surface simply never gets its third width,
 * and reg-suit reports one fewer new item than anyone was counting. Reading
 * this file back is the cheapest thing that can tell a typo from a decision.
 * Once per worker process, against a file already on the page cache.
 */
for (const name of TABLET_SURFACES) {
  if (!readFileSync("e2e/visual.spec.ts", "utf8").includes(`capture(page, "${name}"`)) {
    throw new Error(
      `TABLET_SURFACES names "${name}", which no capture() call uses — it would ` +
        "silently photograph nothing. Fix the name or drop it from the set.",
    );
  }
}

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

/** The seeded long-range run that only sails with six (src/db/seed-minimum-seats.ts). */
const MINIMUM_SEATS_TRIP = "Tortugas Run — 3 days out, 6 divers to sail";

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
  const {
    stalled: stalledFrames,
    unsettled: unsettledImages,
    scrolledAway,
  } = await withRendererBound(
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

        // **Land at the top, last.** The scroll reset used to sit above the
        // image-settle loop, so every frame that loop awaited was a frame in
        // which something else could scroll the page — with nothing putting it
        // back before the shot. `ScrollToHash` is exactly that on a surface
        // opened at a `#fragment`: it `scrollIntoView`s the target on mount, and
        // whichever landed last decided where `position: fixed` chrome painted
        // into the stitched full-page screenshot.
        //
        // Not a theory. `trip-guests-deal-seeded` (opened at
        // `#last-minute-deal`) diffed on two of four commits of a branch whose
        // whole diff was a test comment and some markdown — light on one, dark
        // on another — with identical content, and only the shop header and the
        // staff dock moved, each to where the other had been.
        //
        // Doing it here rather than retrying it is the point: after this line
        // the frame is composited and the shot is taken, so there is no window
        // left to lose. `scrolledAway` reports a page that scrolled anyway,
        // because that is a surface fighting the capture and worth naming — not
        // something to out-wait.
        window.scrollTo(0, 0);
        await settle();
        return { stalled, unsettled, scrolledAway: window.scrollY !== 0 };
      },
      {
        frameWaitMs: FRAME_WAIT_MS,
        scrollBudgetMs: SCROLL_BUDGET_MS,
        imageSettleMs: IMAGE_SETTLE_MS,
      },
    ),
    // A stalled pass painted nothing it can report on, and the warnings
    // below would be lying if they claimed a count; `withRendererBound` has
    // already said what happened.
    { stalled: 0, unsettled: 0, scrolledAway: false },
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
  if (scrolledAway) {
    console.warn(
      `visual: ${page.url()} scrolled itself away from the top three times running — the shot's ` +
        "sticky chrome may sit anywhere, which reads as a phantom diff. Find what is scrolling.",
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

/**
 * Waits out every running (finite) CSS animation — the same
 * `document.getAnimations()` pattern `e2e/a11y.spec.ts` uses to settle a
 * *paint* rather than a *duration*. The command palette gained a real
 * `animate-scale-in`/`animate-fade-in` entrance in this change (issue #832)
 * where it previously had none, and `capture()` shoots the instant its input
 * is focused — mid-transform, not at rest. Exact and not a timing guess:
 * `animate-pulse` skeletons and other infinite animations are excluded so a
 * still-loading surface never hangs this wait.
 */
async function waitForEntranceAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
}

/**
 * **Every capture is shot with CSS transitions switched off, not waited out.**
 *
 * `screenshotOrGiveUp` already passes Playwright's `animations: "disabled"`,
 * and that is not enough: it drives `document.getAnimations()`, which in this
 * Chromium does **not** list a transition running on `::details-content`. So
 * the one transition this app runs seventy times over — the disclosure body's
 * `opacity`/`translate`/`content-visibility` fade in `globals.css` — is
 * invisible to the only mechanism that was supposed to settle it, and the
 * shutter lands wherever it lands.
 *
 * That is issues #1245 and #1276, which are one bug seen at two widths.
 * `capture()` resizes the page itself, from the 1280 base viewport down to
 * 390, and that crosses the `@media (min-width: 40rem)` rule holding a diver
 * record's nine file-group bodies `content-visibility: visible`. Nine bodies
 * therefore begin transitioning on the capture's own resize:
 *
 * - **At 390px, height.** `content-visibility` is a *discrete* property, so
 *   `allow-discrete` holds it `visible` for the whole 200ms and flips at the
 *   end. For those 200ms the bodies are laid out — contributing their height —
 *   while `opacity` has already reached 0. Laid out and invisible is blank
 *   sand: the measured 608px of empty page appended below a pixel-identical
 *   document (#1245).
 * - **At 1280px, colour.** Above `40rem` the bodies are laid out either way, so
 *   no height moves; all that is left is the cards caught mid-fade, one 8-bit
 *   step off full opacity on every channel across four whole card bodies
 *   (#1276, measured row by row).
 *
 * It only ever showed on CI because a transition advances on real frames:
 * idle, `paintWholeDocument`'s scroll-through outlasts the 200ms and the flip
 * lands before the shutter, which is why six local runs came back
 * byte-identical. Starved, `paintWholeDocument`'s settles return via their
 * *timeouts* while the transition stays frozen mid-flight — so the harness
 * stops waiting for the very reason the thing it is waiting on stopped moving.
 *
 * Hence: no wait at all. A transition that cannot run cannot be caught running,
 * on any runner, at any load, with no duration to guess wrong and nothing for a
 * timeout to satisfy. Setting `transition-property` to none also *cancels* one
 * already in flight, snapping the property to its target value, so this settles
 * the disclosures a test opened before `capture()` was called as well as the
 * ones the resize disturbs.
 *
 * `::details-content` is named explicitly because `*, *::before, *::after`
 * does not reach it — it is not one of the two pseudo-elements the universal
 * selector matches, the same gap `globals.css` documents at its reduced-motion
 * kill-switch.
 *
 * Deliberately *not* `reducedMotion: "reduce"` on the context, which would
 * reach the same CSS through the app's own kill-switch: that also flips every
 * `matchMedia("(prefers-reduced-motion: reduce)")` branch in the tree —
 * `MarketingReveal`, `MissingDiversGrid`'s ring, `useExitAnimation`,
 * `ProductChapterNav` — and the suite would quietly stop photographing the app
 * a standard-motion reader sees. Deliberately not `animation: none` either:
 * `.marketing-reveal-pending` holds `opacity: 0` in its base style and relies
 * on its animation's fill to become visible, so cancelling animations would
 * photograph a blank hero. Transitions only, which is what the measurements
 * name.
 */
const CAPTURE_TRANSITIONS_OFF = `
  *,
  *::before,
  *::after,
  *::backdrop,
  details::details-content,
  details[open]::details-content {
    transition: none !important;
  }
`;

/**
 * Runs `shoot` with {@link CAPTURE_TRANSITIONS_OFF} installed, and takes it
 * back out afterwards. Scoped rather than global because the tests keep running
 * after a capture: `useExitAnimation` and friends wait on a real `transitionend`
 * to unmount, and a transition that never runs never fires one.
 */
async function withTransitionsOff<T>(page: Page, shoot: () => Promise<T>): Promise<T> {
  const style = await page.addStyleTag({ content: CAPTURE_TRANSITIONS_OFF });
  try {
    return await shoot();
  } finally {
    // The page may already be navigating or closed if `shoot` threw; losing the
    // cleanup then is harmless, and must not mask the original failure.
    await style.evaluate((node) => node.parentNode?.removeChild(node)).catch(() => undefined);
  }
}

async function capture(page: Page, name: string, scheme: "light" | "dark") {
  const baseViewport = page.viewportSize();
  // Park the pointer somewhere inert, or the capture photographs whatever the
  // test's last click left it hovering.
  //
  // Chromium recomputes `:hover` against a *stationary* pointer on both a
  // resize and a scroll, and the loop below does both — `paintWholeDocument`
  // scrolls the document through in viewport-sized steps. So the element that
  // ends up under the last click's coordinates picks up a hover fill, and which
  // element that is depends on a layout the capture is changing underneath it.
  //
  // It is not theoretical and it is not stable: reg-suit reported
  // `trip-guests-identity-dark-vw-1280` as changed on one run and passing on
  // the next, across a tree that differed **by one Markdown file** — the whole
  // diff being one nav pill rendering `navClass(true)` in one run and its
  // `hover:` pair in the other. It flips in both directions, so the risk is not
  // only a diff to explain: a hover state can equally mask a real change, and a
  // capture known to be noisy is one a reviewer starts waving through.
  //
  // Once here rather than per viewport: the pointer does not move between them,
  // and the goal is only that it is over nothing. `(0, 0)` is the viewport
  // corner and no surface in this suite puts an interactive element there.
  // `capturePrint` needs none of this — `emulateMedia({ media: "print" })`
  // already drops hover styling.
  await page.mouse.move(0, 0);
  // Never shoot the shell standing in for the page. Every route is
  // `instant = true`, so its own `<h1>` is prerendered and a heading wait can
  // be satisfied while `loading.tsx`'s skeleton still stands where the body
  // will be — the trap #641 found on `dive-sites-library`, and the one
  // `scripts/screenshot.mjs` fell into wholesale (#643). Waiting for the last
  // `animate-pulse` to leave `<main>` is one rule that covers every capture,
  // including whichever is added next, without a per-capture selector.
  await page.waitForFunction(
    () => !document.querySelector("main .animate-pulse:not([data-live-pulse])"),
    undefined,
    {
      timeout: 15_000,
    },
  );
  // The standard pair, plus the portrait tablet for the five staff surfaces a
  // shop runs on one. Widest last is deliberate: the base viewport is restored
  // below either way, but a capture that fails mid-loop leaves the page at a
  // width a trace viewer can make sense of.
  const viewports = TABLET_SURFACES.has(name) ? [...VIEWPORTS, TABLET_VIEWPORT] : VIEWPORTS;
  await withTransitionsOff(page, async () => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await paintWholeDocument(page);
      await screenshotOrGiveUp(page, `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`);
    }
    // capture() runs mid-flow (navigation and clicks continue after it), so
    // restore the base viewport the test was using before resizing for each
    // capture above — matching what the old Argos `viewports` option did.
    // Inside the switch-off, so the last resize does not leave a transition
    // running into whatever the test does next.
    if (baseViewport) await page.setViewportSize(baseViewport);
  });
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
/**
 * **A sticky footer, photographed — because `capture()` above cannot see one.**
 *
 * Chromium's full-page screenshot stitches the document at scroll 0, and a
 * `position: sticky` element that is *currently stuck* — offset from its
 * static position — is simply not painted into that image. Measured on the
 * course editor: the page is 8,531 px tall, `Save course page` reports a
 * bounding box at y=744 (pinned to the viewport foot), and the resulting
 * 8,531 px capture contains **no pixel of it anywhere**. The baseline for the
 * app's longest form had lost its only primary action, silently.
 *
 * Scrolled to the foot the sticky offset is zero, so the element is at its
 * static position and paints normally — which is what this does. Viewport-
 * sized rather than full-page: the bar in its own context is the whole
 * subject, and a second 8,000 px image of the same form is not.
 *
 * Any surface that adopts `StickyFormActions` needs one of these, or its bar
 * has no baseline at all.
 */
async function captureStickyFoot(page: Page, name: string, scheme: "light" | "dark") {
  const baseViewport = page.viewportSize();
  // Both viewports, like `capture()` — the phone is where a bar pinned to the
  // bottom edge earns its place, so photographing only the desktop would leave
  // the case that motivated it unbaselined.
  await withTransitionsOff(page, async () => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await paintWholeDocument(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // The scroll is a layout change like any other; let it commit before the shot.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.screenshot({
        path: `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`,
        animations: "disabled",
      });
    }
    if (baseViewport) await page.setViewportSize(baseViewport);
  });
}

async function capturePrint(page: Page, name: string) {
  // Switching media repaints the whole document in print tokens, which is a
  // property change like any other and so can start transitions of its own —
  // the same class of race as the resize in `capture()`. Both `emulateMedia`
  // calls sit inside the switch-off for that reason.
  await withTransitionsOff(page, async () => {
    await page.emulateMedia({ media: "print" });
    await page.addStyleTag({ content: "@page { size: 8.5in 200in; }" });
    // After the media switch, so the bands rasterized are the print layout's.
    await paintWholeDocument(page);
    await screenshotOrGiveUp(page, `e2e/screenshots/${name}-print.png`);
    await page.emulateMedia({ media: "screen" });
  });
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
 * The staff departure-log path for the seeded four-dive Deep Diver session —
 * the only departure in the demo that runs the maximum number of dives, and so
 * the only one whose roll-call tables reach eight columns.
 *
 * Reached through the course's own public page rather than the schedule board,
 * which is a keyset-paged stream: that session sails twenty days out, behind an
 * unknown number of pages of departures that other seed scenarios are free to
 * add to. The course page lists every upcoming session of one course and links
 * each to its trip, so this resolves in one navigation and stays resolved when
 * the board's contents change.
 */
async function deepDiverLogPath(page: Page): Promise<string> {
  await page.goto("/s/blue-mantis/courses/deep-diver");
  const href = await page.locator('#dates a[href*="/trips/"]').first().getAttribute("href");
  const tripId = href?.split("/trips/")[1];
  // Not a soft assertion: a null here would otherwise navigate to
  // `/shop/blue-mantis/trips/undefined/log`, which `uuidParam` answers with a
  // 404 — and a capture of a 404 is a baseline nobody reads twice.
  expect(tripId, "the Deep Diver course page lists its seeded session").toBeTruthy();
  return `/shop/blue-mantis/trips/${tripId}/log`;
}

/**
 * Wait until this page is *controlled* by the offline service worker, before
 * navigating into a shell surface that photographs it.
 *
 * `OfflineShellVersionBanner` renders "A newer version of DiveDay is ready"
 * off a `controllerchange` event, which fires exactly once per context: when
 * the worker `primeOfflineManifestShell()` just registered activates and
 * claims its clients. Whether that lands before or after `capture()` is a
 * straight race, and it decided a baseline — `offline-manifest-list-dark`
 * carried the banner on `fc0950b` and not on the run after it, on a commit
 * that touched neither the shell nor the worker.
 *
 * Waiting here rather than on the shell page is the whole point: once the
 * controller is in place *before* the shell loads, the banner's listener
 * mounts with nothing left to hear, so the surface is photographed in the
 * steady state a crew member actually meets. Masking the banner would have
 * hidden a real control instead.
 *
 * Only for captures that reach the shell through a primed manifest page. The
 * empty/discarded states deliberately suppress priming, so no worker ever
 * claims them and there is no race to cut.
 */
async function settleOfflineShellWorker(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
}

/**
 * One diver's record, found by search rather than by scrolling: the demo shop
 * has enough divers to page the roster, so nobody is reliably on the first
 * page.
 *
 * The roster row *is* the door — one stretched link named for the diver (ADR
 * 20260827-people-not-lists) — so this clicks the link by name rather than the
 * initials avatar it used to, which went with the table.
 *
 * Parks the pointer at (0,0) before returning. The roster row this clicks sits,
 * at 390, exactly where the record's sub-nav bar lands — so the pointer left
 * behind by the click renders one tab in its hover state, and the phone
 * baselines photographed a "Fit" that looked selected. Deterministic, so never
 * a flake; just a lie about state that a reviewer has to re-derive every time.
 * (0,0) is the demo banner, which has nothing hoverable in the corner.
 */
async function openDiverProfile(page: Page, search: string, fullName: string) {
  await page.goto(`/shop/blue-mantis/divers?q=${search}`);
  await page.getByRole("link", { name: fullName, exact: true }).click();
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
  workerBaseURL: string,
  storageState: string,
  title: string,
): Promise<string> {
  const context = await browser.newContext({ baseURL: workerBaseURL, storageState });
  try {
    return await seededTripId(makeActivitySafe(await context.newPage()), "blue-mantis", title);
  } finally {
    await context.close();
  }
}

/**
 * Book the seeded reef charter as a fresh visitor and settle where booking
 * now lands: the diver's own `/ready`, opened on `?booked=1` (ADR
 * 20260820-one-page-after-booking). Shared by the `booking-confirmed` and
 * `readiness` captures, which each run it against their own reseeded fixture.
 *
 * The name and email are fixed per scheme rather than unique per run: both
 * render on the page, so a wall-clock or random value there would be a
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
  await expect(page).toHaveURL(/\/ready\//);
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

/**
 * A `savedAt` that lands a copy squarely in the "aging" tier — past the
 * 15-minute current threshold, inside the 4-hour stale one — so the list's row
 * reads "Saved 2 hours ago" against the frozen clock. Derived from the same
 * constant the product classifies with, so moving the tier moves this with it
 * rather than leaving the seed on the wrong side of it.
 */
const AGING_SAVED_AT = new Date(
  Date.parse(E2E_FROZEN_CLOCK) - OFFLINE_MANIFEST_AGING_MS / 2,
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
    /**
     * When this device last took a copy. The app always writes "just now", so
     * this is the only way to photograph a copy old enough to have stopped
     * being current while still being perfectly readable — which is the state
     * the list's pill exists for.
     */
    savedAt?: string;
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
        // Ahead of the event loop below, which stamps each queued roll call
        // with the snapshot's own `savedAt`: a record whose events disagreed
        // with the snapshot they were recorded against is not a state the app
        // can produce, and the reconciler reads that field.
        if (change.savedAt) envelope.snapshot.savedAt = change.savedAt;
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
  await offlineCopySaved(page);
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
      /**
       * **The counter's QR door** (issue #1236): the form a walk-in fills in
       * before any booking exists. Three groups — who they are, what they say
       * their card is, and the sizes that save a fitting — on a page a shop
       * prints a QR for and puts on the desk.
       */
      test(`the shopfront's register form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/register");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.getByRole("button", { name: "Send it to the shop" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "shopfront-register", scheme);
      });

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

      // Where the trial actually starts: two group labels over six fields, the
      // storefront address written under the shop link, and the one sentence a
      // skeptical owner reads before typing a password (ADR
      // 20260827-first-light, decision 1).
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

      // The sent door — the only home of the `sent` mark, and the one terminal
      // state reachable without a real token (ADR 20260827-first-light,
      // decision 2: the mark is a drawn stroke, never an emoji, so it is now a
      // thing a baseline can hold to across platforms at all). `?sent=1` is
      // exactly what the enumeration-safe action redirects to for every
      // outcome, so this is the real page and not a mock of it.
      test(`the reset-sent door renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password?sent=1");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password-sent", scheme);
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

      test(`the invalid contact-confirmation notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/confirm-contact/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "confirm-contact-invalid", scheme);
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

      /**
       * The same board read by someone who has said what they can dive.
       *
       * The whole design decision is visual and lives nowhere else: the
       * departures above the stated level are **dimmed and marked**, not
       * removed, with the count said once in the filter row and a two-word chip
       * on each card (issue #696). A capture is the only thing that can tell a
       * dimmed-and-still-there card from a missing one.
       */
      test(`the public schedule marks what a diver cannot dive (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis?canDive=open_water");
        await publicReefCard(page).getByRole("link").waitFor();
        await page.getByText("Above your level").first().waitFor();
        await capture(page, "schedule-above-level", scheme);
      });

      // A departure that no longer exists, which is what a link on a flyer or
      // in last season's Instagram post resolves to. It is a *shop* surface
      // now rather than DiveDay's app-wide 404 (issue #765), so the thing to
      // look at is that the shop's header, nav and footer frame it and that
      // one action leads back to the board.
      test(`a dead link inside a shop renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/trips/00000000-0000-4000-8000-000000000000");
        await page.locator("h1").first().waitFor();
        await capture(page, "shop-not-found", scheme);
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

      /**
       * The embed catalogue's three framed widgets (ADR
       * 20260901-diveday-reimagined, slice 13d): what a shop's own website
       * shows once the loader has mounted them. Photographed at their own
       * routes, which are embeds by path — no chrome, the credit line, and
       * the demo shop's brand through the same `BrandStyle` the storefront
       * reads. The departure card takes the next public departure off the
       * grid rather than a literal id, so the capture survives a re-seed.
       */
      test(`the embed grid renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/grid");
        await page.getByRole("link", { name: "Book" }).first().waitFor();
        await capture(page, "embed-grid", scheme);
      });

      test(`the embed departure card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/grid");
        const href = await page.getByRole("link", { name: "Book" }).first().getAttribute("href");
        const tripId = /\/trips\/([^/#?]+)/.exec(href ?? "")?.[1];
        expect(tripId).toBeTruthy();
        await page.goto(`/s/blue-mantis/embed/departure?show=${tripId}`);
        await page.getByRole("link", { name: "Book" }).waitFor();
        await capture(page, "embed-departure", scheme);
      });

      test(`the embed course list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/courses");
        await page.getByRole("link", { name: "Enrol" }).first().waitFor();
        await capture(page, "embed-courses", scheme);
      });

      /**
       * **The one place a booking does not end on `/ready`** (ADR
       * 20260820-one-page-after-booking). Inside the iframe the frame stays put
       * — `/ready/**` is outside the framing allowlist, so redirecting there
       * would hand a shop's own visitor a CSP-blocked frame — and
       * `EmbedBookedNotice` says the seat is taken and offers one `target="_top"`
       * way out.
       *
       * It gets its own baseline because it is a *different surface* from the
       * `booking-confirmed` capture above, not a narrower rendering of it: short
       * where that page is long, and the only diver-facing screen in the product
       * whose whole job is to hand off to another window.
       */
      test(`the embedded booking confirmation renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis?embed=1");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        // Fixed per scheme, like `bookAVisualRegressionSeat`: the name renders,
        // so a random one would be a permanent diff rather than a regression.
        await page.getByLabel("Name", { exact: true }).fill("Embed Regression Diver");
        await page.getByLabel("Email", { exact: true }).fill(`embed-visual-${scheme}@example.com`);
        await page.getByRole("button", { name: /^Book/ }).click();
        await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
        // Still framed, and still on the trip page — the assertion that this
        // capture is of the embed branch and not a `/ready` that leaked in.
        await expect(page).toHaveURL(/embed=1/);
        await capture(page, "booking-confirmed-embed", scheme);
      });

      // The seeded reef trip's public page: hero, "The day", the route, "Look
      // for", the site's own words, the conditions line, the one-line
      // requirement, and the form last (ADR 20260827-the-divers-thread,
      // decision 2). The swipeable field-guide deck it used to photograph is
      // gone as of slice 7c; the shop's authored prose came back beneath the
      // pitch as `TripSiteNotes`, because deleting the deck had left eight
      // columns the staff form writes reaching no diver at all.
      //
      // Reached from the *standalone* schedule, never the embed: a schedule
      // loaded with `embed=1` carries the flag forward on its trip links, and
      // this baseline is the full-chrome page. Its own test now, so that can no
      // longer depend on which capture ran before it.
      test(`the public trip briefing renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page.getByRole("heading", { name: "The day" }).waitFor();
        // The form is the last section and a Client Component; waiting on it
        // hydrating is what makes this the settled page rather than a shot of
        // the form mounting.
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
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
        workerBaseURL,
        staffStorageState,
      }) => {
        // A board crawl on a second context, then the capture. Same
        // aggregate-cost reasoning as the waiver and recap tests below.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await tripIdWithoutSigningIn(
          browser,
          workerBaseURL,
          await staffStorageState("owner"),
          ADVANCED_CHARTER,
        );
        await page.goto(`/s/blue-mantis/trips/${tripId}`);
        // One unboxed line above the form, no heading over it (ADR
        // 20260827-the-divers-thread, decision 2).
        await page.getByText(/^This charter is for divers with/).waitFor();
        // The booking form is a Client Component below the note; wait for it to
        // hydrate so the shot is of the settled page, not of the form mounting.
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await capture(page, "site-briefing-requirements", scheme);
      });

      /**
       * **A dock day the departure's own legs lay out** (ADR
       * 20260815-per-leg-travel-minutes).
       *
       * `site-briefing` above photographs the reef morning, where the legs are
       * short and the day therefore reads exactly as it did on the shop's single
       * ride-out figure — which is the correct outcome there and proves nothing
       * about the column. The seeded long-range run is the only departure in the
       * demo whose *second* leg is longer than the shop's surface interval, and
       * that is the one shape that changes which beat a diver reads: the gap
       * between two dives is `max(surfaceInterval, travel)`, so at 75 minutes
       * the window is named "Ride to the next site" instead of "Surface
       * interval". Until this capture, no baseline had ever rendered that beat.
       *
       * Its id comes off the staff board on a disposable context, the same
       * CR-019 pattern as the requirement note above, so `page` stays the
       * unauthenticated visitor whose page is being photographed — who now has
       * to *hold a seat* to read it: the dock-day rhythm moved to the diver's
       * own thread when the trip page stopped selling and preparing at once
       * (ADR 20260827-the-divers-thread, decision 2).
       */
      test(`the departure's own legs lay the dock day out (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await tripIdWithoutSigningIn(
          browser,
          workerBaseURL,
          await staffStorageState("owner"),
          MINIMUM_SEATS_TRIP,
        );
        await page.goto(`/s/blue-mantis/trips/${tripId}`);
        // Fixed per scheme, like `bookAVisualRegressionSeat`: the name renders,
        // so a random one would be a permanent diff rather than a regression.
        await bookASeatAndOpenThread(
          page,
          `Leg Regression ${scheme === "light" ? "Day" : "Night"}`,
        );
        await page.getByRole("heading", { name: "Your dock-day rhythm" }).waitFor();
        // The beat only a stated leg can produce, and the reason this capture
        // exists — waiting on it means the shot can never be of a day that
        // quietly fell back to the shop's twenty minutes.
        await page.getByText("Ride to the next site").waitFor();
        await capture(page, "dock-day-legs", scheme);
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
       * **The thread's after-state**, reached through the recap token: the same
       * surface `/ready` renders once the boat is home (ADR
       * 20260827-the-divers-thread, decision 4 — slice 7d folded `/recap` into
       * it), minted for the pinned demo booking (src/db/seed.ts) so the marquee
       * word-of-mouth surface has a stable baseline with no in-app link to
       * reach it.
       *
       * The capture keeps its `recap` name, because what it is a picture *of* —
       * the day after — has not changed. What it now photographs is the
       * welcome-home greeting, the one dive record, the crew's word, the single
       * review ask, and the run of quiet doors at rest.
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
        workerBaseURL,
        staffStorageState,
        request,
      }) => {
        // A settings round-trip on a second context, a test-route write, then
        // the tallest capture in the file.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const reviewSettingsContext = await browser.newContext({
          baseURL: workerBaseURL,
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
        await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // The tip door renders at all only for a shop that can take a tip, and
        // that is what the seed-stripe-account write above buys — so waiting on
        // it is what proves the whole run of doors is in the frame.
        await page.getByText("Tip your crew", { exact: true }).waitFor();
        await capture(page, "recap", scheme);
      });

      /**
       * **The day that went somewhere else** (issue #1191, D31).
       *
       * The recap above is the ordinary shape: a plan, and no record
       * disagreeing with it. This is the other branch — a divemaster wrote
       * dive one down at a different site, so the record card names where the
       * boat went and keeps the plan beneath it under "Planned".
       *
       * Seeded through a test route rather than into blue-mantis, for the
       * reason AGENTS.md gives for the trouble states: a demo shop whose every
       * recap says the boat went elsewhere is a worse demo, and the branch
       * worth a baseline is the rare one. Mutating is safe — each worker owns
       * its database and resets before every test.
       */
      test(`a recap whose record left the plan renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-changed-dive-site");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // The "Planned" row is the whole subject: waiting on it is what proves
        // the comparison fired rather than photographing the calm variant
        // twice.
        await page
          .getByTestId(AFTER_STATE_TEST_IDS.plannedSites)
          .filter({ visible: true })
          .waitFor();
        await capture(page, "recap-record-left-plan", scheme);
      });

      /**
       * **The field guide, open** (issue #1192, D32).
       *
       * The drawer is shut on arrival, so the `recap` capture above already
       * photographs it — as one hairline row and nothing else. What needs a
       * baseline is what is behind it: the faces each site is known for, under
       * that site's own name, which is what keeps the guide a statement about a
       * *place* rather than a report of what this dive saw.
       *
       * Molasses and French both carry a seeded guide (`seed-dive-sites.ts`),
       * so no test route is needed — this is the demo shop's ordinary state.
       */
      test(`the recap's field guide renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        await page.locator("[data-recap-door='field-guide'] summary").click();
        // A species name is what proves the drawer opened *and* that the
        // catalog copy resolved — an open door with no faces in it would
        // photograph as a heading over nothing.
        await page
          .locator("[data-recap-door='field-guide']")
          .getByText("Stoplight parrotfish", { exact: true })
          .first()
          .waitFor();
        await capture(page, "recap-field-guide", scheme);
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
        workerBaseURL,
        staffStorageState,
      }) => {
        // Board → trip → Guests → send, on a second context, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const staffContext = await browser.newContext({
          baseURL: workerBaseURL,
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
        await staffPage.waitForURL(/\/trips\/[a-f0-9-]+$/);
        const diverSection = staffPage.locator("#roster");
        await diverSection
          .getByRole("button", { name: "Send waiver", exact: true })
          .first()
          .click();
        const resultNotice = diverSection.getByRole("status");
        await resultNotice.waitFor();
        const waiverHref = await waiverLinkFromResult(staffPage, resultNotice);
        await staffContext.close();

        await page.goto(waiverHref);
        await page.getByRole("heading", { name: "A quick step before the dock" }).waitFor();
        await capture(page, "waiver-active", scheme);

        /**
         * The same page once the diver has worked through it: the step rail at
         * 2 of 3 with Release and Medical settled and Sign still open, the
         * questionnaire's own outcome line under the answers, and Sign as the
         * page's one filled button with saving demoted to the text link beside
         * the expiry sentence (ADR 20260827-the-divers-thread, decision 5).
         *
         * It rides on the capture above rather than taking a test of its own:
         * minting a waiver link is a real staff send on a second context, and
         * answering the form afterwards costs nothing but client-side clicks.
         */
        const noRadios = page.getByRole("radio", { name: "No" });
        const questionCount = await noRadios.count();
        for (let index = 0; index < questionCount; index++) {
          await noRadios.nth(index).check();
        }
        // Wait on the rail's own statement that every answer landed — never a
        // timeout, and never the last click's own resolution, which says
        // nothing about the count two components away from it.
        await page.getByTestId("waiver-step-rail").getByText("2 of 3 done").waitFor();
        await capture(page, "waiver-rail", scheme);

        /**
         * The same page one honest answer later. "I am over 45 years of age" is
         * the most ordinary yes on a dive boat and it puts Box B's four
         * required questions on the page: the Box's own rule beside the
         * questions it opened, the outcome line saying they are still to
         * answer, and the rail dropping back to 1 of 3 because the medical step
         * is open again. Every capture before this one answers "No" to
         * everything, so no Box had ever been photographed (2026-08-28 review).
         */
        await page
          .getByRole("group", { name: /I am over 45 years of age/ })
          .getByRole("radio", { name: "Yes" })
          .check();
        await page.getByTestId("waiver-step-rail").getByText("1 of 3 done").waitFor();
        await capture(page, "waiver-rail-follow-ups", scheme);
      });

      /**
       * The moment the whole public funnel exists for: `/ready` as it looks in
       * the seconds after a seat is taken — the "You're on the boat" earned
       * moment, the emails line, and the checklist under it (ADR
       * 20260820-one-page-after-booking). It was a branch of the trip page
       * until 2026-08-20; the capture keeps its name, because what it is a
       * picture *of* — the confirmed state — has not changed.
       *
       * It and `readiness` below are now the same route in two states, and
       * that is the point of having both: this one on `?booked=1`, the other
       * on the plain link a shop sends the night before. They each run their
       * own booking rather than sharing one. That used to be forbidden — a
       * second real booking inside the public tour would have moved the seat
       * counts every capture after it depended on (CR-019) — but the per-test
       * `demoReset` in e2e/fixtures.ts reseeds the demo shop before each of
       * these, so each books against the same fixture and neither can see the
       * other's seat.
       */
      test(`the booking confirmation renders true to the design (${scheme})`, async ({ page }) => {
        // A real booking through the public form, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await capture(page, "booking-confirmed", scheme);
      });

      // The same page on the *durable* link — what a diver opens from the
      // night-before email, days after the celebration above has been flashed
      // out of the URL. Reloading without `?booked=1` is exactly how a diver
      // reaches it, so that is how it is captured. One full-page shot covers
      // the whole thread at rest: the status figure, the spine with its first
      // step open and every other one a line, and the packing list below (ADR
      // 20260827-the-divers-thread, decision 3).
      test(`the diver's thread renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await capture(page, "readiness", scheme);
      });

      /**
       * **The thread with a later step opened**, which the capture above can
       * never show: at most one step is open at rest, and the one at rest is
       * always the first thing on the diver. Everything the spine does with a
       * form — the rental fit's own controls, a step's fine print, the
       * disclosure the diver just closed to get here — only renders in this
       * state, and nothing had ever photographed it.
       */
      test(`the thread's opened step renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await openThreadStep(page, "gear");
        await capture(page, "thread-prep-current-step", scheme);
      });

      /**
       * **The card a diver meets on their worst day**, which nothing had ever
       * photographed — in either language or either scheme (issue #859).
       *
       * `ExpiredLinkCard` is what a dead bearer link renders, and it has two
       * shapes worth a baseline. This is the attributed one: the shop named,
       * its contact link, and — since issue #850 — a button that mails a fresh
       * link to the address already on the booking. `e2e/readiness.spec.ts`
       * drives it and asserts every string on it; what nothing looked at is
       * the notice band's tone against the card and how the button sits above
       * the "Need help?" line.
       *
       * Reached the only way it can be: book a seat, release it, and open the
       * bare URL. Cancelling revokes this very token, which is what makes the
       * link dead — no fixture hands you one.
       */
      test(`a dead readiness link renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await page.getByRole("button", { name: "Cancel my spot" }).click();
        await page.getByRole("button", { name: "Yes, cancel my spot" }).click();
        await page.getByRole("heading", { name: "This booking was cancelled" }).waitFor();
        // Without `?cancelled=1` — the bookmarked URL, or the link out of an
        // old reminder email, which is how a diver actually arrives here.
        await page.goto(new URL(page.url()).pathname);
        await page.getByRole("heading", { name: /readiness link isn.t available/ }).waitFor();
        await capture(page, "expired-link-readiness", scheme);
      });

      /**
       * The same component's other shape: **no shop to attribute it to.** A
       * token that resolves to no record at all reveals nothing about why,
       * which is the bearer-token model's own guarantee — so the card is the
       * heading, the sentence, and nothing else. Worth its own baseline
       * precisely because it is the one with no content to hold it up.
       */
      test(`an unknown bearer link renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/waivers/not-a-real-token");
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await capture(page, "expired-link-unknown", scheme);
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
        await choosePartySize(page, 2);
        await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
        await page.getByLabel("Email", { exact: true }).fill(`organizer-${scheme}@example.com`);
        await page.getByLabel("Diver 2 name").fill("Sam Reyes");
        await page.getByLabel("Use the main contact's email for this diver").check();
        await page.getByRole("button", { name: /^Book/ }).click();
        await page.getByRole("heading", { name: /You’re on the boat/ }).waitFor();
        await expect(page).toHaveURL(/\/ready\//);
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

        /**
         * **The third state of the same link: spent** (ADR
         * 20260827-first-light, decision 3, slice 10c). Claiming revokes every
         * capability on the booking, so the URL the organizer shared into a
         * group chat is dead the moment the seat changes hands — and it is the
         * *ordinary* way this page is reached, not an edge case. The token
         * still resolves to a row this app issued, which is what earns the
         * booking tier: the shop's name and its way in. What the sentence
         * beside it may say is set by the *worst* of the six causes that share
         * this card — a cancelled seat, a departure called off — so it names
         * whoever sent the link and claims nothing about the seat. Captured
         * from the real spent link rather than a hand-made expiry, because the
         * revocation is the thing.
         */
        await page.getByLabel("Your name").fill("Sam Reyes");
        await page.getByLabel("Your email").fill(`claimant-${scheme}@example.com`);
        await page.getByRole("button", { name: "Claim this seat" }).click();
        await expect(page).toHaveURL(/\/ready\//);
        await page.goto(claimPath ?? "/");
        await page.getByRole("heading", { name: /link isn.t available/ }).waitFor();
        await capture(page, "expired-link-claim", scheme);
      });

      // Its own test rather than another stop on a public tour: a trust page
      // whose baseline is skipped because a long test ran out of budget is the
      // one baseline you'd most want.
      /**
       * The two legal pages, published 2026-08-14
       * (FU-20260812-no-privacy-or-terms-page). Their own captures rather than
       * a stop on a public tour, for the same reason `/about` has one: these
       * are long unbroken columns of prose, which is the shape that breaks
       * quietest — a measure that runs too wide, a dark-mode contrast that
       * fails on muted body text, a definition list whose term and body run
       * together. Nothing about them is interactive, so a screenshot is
       * genuinely the whole test.
       */
      test(`the privacy page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/privacy");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "privacy", scheme);
      });

      test(`the terms page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/terms");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "terms", scheme);
      });

      test(`the about page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/about");
        await capture(page, "about", scheme);
      });

      // The migration-guides hub: one ruled row per thing a shop might be
      // leaving, the entry point to the portability wedge on the marketing side.
      // Also the only baseline covering `ImportPreviewFallback`, the mockup that
      // makes this page's "exactly what comes across" promise visible instead of
      // merely stated — its mapped-column chips and skipped row are the parts a
      // diff here should be read against.
      test(`the switching hub renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching");
        await page.getByRole("heading", { name: "The door swings both ways." }).waitFor();
        await capture(page, "switching-hub", scheme);
      });

      // The "Switching from EVE" migration guide: the marketing face of the
      // portability wedge — export click-path, the shared scope table, and the
      // importer, on the market's most motivated switching pool. Represents the
      // one shared composition (`src/app/switching/_components/guide.tsx`) that
      // every guide, incumbent or not, renders as a single numbered move rail.
      test(`the EVE switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/eve");
        await page.getByRole("heading", { name: "Moving your shop off EVE" }).waitFor();
        await capture(page, "switching-eve", scheme);
      });

      // The non-incumbent switching guide: shops coming from a spreadsheet — the
      // market's largest under-served pool. Same shared composition as the
      // incumbent guides, with its own first phase (columns-that-matter, the
      // downloadable template) and three rail phases instead of four — there is
      // no incumbent to cut over from.
      test(`the spreadsheet switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/spreadsheet");
        await page.getByRole("heading", { name: "The spreadsheet got you this far." }).waitFor();
        await capture(page, "switching-spreadsheet", scheme);
      });

      // The FareHarbor guide: the coexist-led variant of the composition, for a
      // booking channel a shop keeps rather than a records system it leaves —
      // the "keep it, or leave it" section (the ruled run-the-day list plus the
      // leave path) that only the channel guides render.
      test(`the FareHarbor switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/fareharbor");
        await page
          .getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-fareharbor", scheme);
      });

      // The Rezdy guide: the second booking-channel guide, same coexist shape
      // with its own copy (a monthly-plus-per-booking model). Baselined so its
      // page — and the extra hub row it adds — stay pixel-stable.
      test(`the Rezdy switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/rezdy");
        await page
          .getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-rezdy", scheme);
      });

      /**
       * The seeded demo shop's day spine never runs dry, so the shared
       * `EmptyState` card the spine renders when nothing needs attention
       * (docs/design/principles.md, terminal-vs-section empty states) has no
       * other baseline. A freshly onboarded shop is the real "empty queue"
       * scenario — same flow as e2e/onboard.spec.ts's first-run checklist test.
       *
       * **Two captures in one test, deliberately.** `settings-trial` is
       * this shop's Settings page — the trial-status card only ever renders
       * for a real (non-demo) trial shop, so `blue-mantis` (the seeded demo
       * shop the other settings capture uses) can never show it. Both
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
        await page.getByRole("heading", { name: "First morning" }).waitFor();
        // The canvas's `FirstMorning` board: the setup ledger as the day
        // spine's leading group, under its own group label (ADR
        // 20260827-first-light, decision 6). The checklist is the page now. The queue's "Nothing is waiting on
        // you" state — a claim about a roster this shop does not have — used to
        // render directly beneath it, and the header sentence above said "No
        // boats out today" of a shop that has never had a board (issue #711).
        await expect(page.getByRole("heading", { name: "Nothing is waiting on you" })).toHaveCount(
          0,
        );
        await capture(page, "today-empty", scheme);

        // **`today-empty-departures` retired here**, with the by-departure view
        // it photographed: that capture existed to catch `BlockerGroups`'s own
        // `EmptyState`, and both are gone (ADR
        // 20260827-clearwater-surface-language, decision 4). The one empty
        // state left on this page is the spine's, which `today-empty` above
        // already frames.

        // **The page this shop is told to paste on its website.** Step 4 of the
        // checklist above hands over this URL, and nothing had ever
        // photographed what a visitor finds at it before the shop has data —
        // the seed, the specs and every other capture see a shop with a board.
        // What was there: an empty state telling a diver to call a number the
        // page withholds, a discount list for boats that do not exist, and the
        // one form that would help switched off because the shop had not set a
        // contact email (issue #710). Free to take here — the shop already
        // exists and this is one navigation.
        await page.goto(`/s/${unique}`);
        await page.getByRole("heading", { name: "No trips on the books yet" }).waitFor();
        // **Day zero is a shape, not a failure state** (ADR
        // 20260827-clearwater-surface-language, decision 8). The hero is the
        // shop's name and nothing else — no tagline it has not written, no
        // rating nobody has left, no DiveDay sentence standing in for either —
        // and with no boat to book, the page's one primary becomes the
        // date-request composer's own submit.
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fresh Shop E2E");
        await expect(page.getByRole("region", { name: "Next boat out" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Book this boat" })).toHaveCount(0);
        await capture(page, "public-schedule-new-shop", scheme);
        // After the shot, so the composer's disclosure is closed in the
        // baseline: with no boat to book, the page's one primary is this.
        await page.locator("#request-a-date summary").click();
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

        // **The board before anything is on it.** The `schedule-builder`
        // baseline is shot against blue-mantis, whose board always has
        // fourteen departures, so the state a new owner actually opens on had
        // no capture at all — and it had grown four controls, two of them
        // primary-weight, one of which ("Add a booking") leads to a departure
        // picker with no departures in it (issue 797). The header now stands
        // down here and the empty state holds the one door. Free to take —
        // the shop and the session already exist.
        await page.goto(`/shop/${unique}/schedule/board`);
        await page.getByRole("heading", { name: "Nothing upcoming on the board" }).waitFor();
        await capture(page, "schedule-builder-empty", scheme);

        // **`close-out-quiet` and `close-out-closed` retired here**, with the
        // route they photographed (H-62; ADR
        // 20260827-clearwater-surface-language, decision 4). Neither state is
        // reachable on a fresh shop any more: the evening is a state of the
        // shop home, and a shop with no departures has no day to close — its
        // home is the setup ledger `today-empty` above already frames. Both
        // moments moved to `today-evening` / `today-evening-closed`, shot
        // against the demo shop with `seed-evening`, which is the only place
        // a settled day exists.

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

        // The orientation's *other* form, on the same shop rather than a
        // second sign-up. `RoleOrientationCard` above is what a Today with
        // nothing on it renders; the moment the page has work to show
        // (`hasWorkToShow`, src/app/shop/[shopSlug]/page.tsx) the same pointer
        // compresses to `RoleOrientationLine` so the queue keeps the top of
        // the page. Reaching that state needs a real shop whose owner has not
        // dismissed orientation *and* a queue row — the demo shop suppresses
        // orientation entirely and `today-empty` deliberately has no bookings,
        // so no other capture in this suite can render the line.
        //
        // One hand-entered diver is enough: seating owes a waiver on join
        // (src/db/seat-diver.ts), the departure is inside the operational
        // horizon, so Today gains a waiver row.
        await page.goto(`/shop/${unique}/bookings/new`);
        await page.getByRole("link", { name: /Two-Tank Morning Reef/ }).click();
        await page.getByRole("link", { name: "Add diver" }).click();
        await page.waitForURL(/\/divers\/new\?/);
        // Name only — this door takes the no-email diver, which also keeps the
        // seat from queuing a notification whose delivery state would vary.
        await page.getByLabel("Full name").fill("Marisol Vega");
        await page.getByRole("button", { name: "Add to trip" }).click();
        await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

        await page.goto(`/shop/${unique}`);
        // The line's own tour link, which is what the line exists to keep.
        await page
          .getByRole("link", { name: "Open Board to see this week's departures." })
          .waitFor();
        // ...and proof it is the line and not the card: the two forms share
        // that link, so waiting on it alone would pass on either.
        await expect(
          page.getByRole("heading", { name: "New here? A few pointers for your role." }),
        ).toHaveCount(0);
        // **The coral morning, in the same frame** (the canvas's `FirstBooking`
        // board; ADR 20260827-first-light, decision 6). Marisol Vega is this
        // shop's first booking ever and her departure is still ahead, so the
        // once-ever moment is live here — and it is live in exactly one place
        // in the suite, because every other shop with bookings has more than
        // one. Deliberately *not* a second capture: it is the same page at the
        // same viewport, and a duplicate frame buys a name, not a baseline.
        await expect(page.getByText("Your first booking")).toBeVisible();
        // `.first()`: her name is also the subject of the waiver row her own
        // seat just created, which is the point — the moment names the diver,
        // the queue names the job.
        await expect(page.getByText("Marisol Vega").first()).toBeVisible();
        await capture(page, "today-orientation-line", scheme);
      });
    });

    /**
     * The marketing header's second face. `MarketingNavView` renders two
     * different bars off one session read: signed out it offers "Sign in" and
     * "Try the live demo" (#934); signed in it drops the sign-in link entirely
     * and turns the CTA slot into the way back to that staffer's own shop.
     * Every public capture above is the signed-out bar, so the signed-in one —
     * the header a shop owner actually sees every time they come back to read
     * the pricing page — had no baseline at all.
     *
     * Its own `test.describe` because `signedInAsOwner()` is a describe-scoped
     * `storageState`; the sibling "public" block must stay anonymous.
     *
     * Shot on `/onboard` rather than the landing page for two reasons. It is
     * the shortest marketing surface (one form), so the duplicated body below
     * the header costs the least; and it is the one page that sets `hideCta`,
     * where the signed-in branch has a documented rule with nothing watching
     * it — the CTA *pitch* is suppressed, but the way back to your own shop is
     * wayfinding and still renders. The header markup is identical on every
     * marketing route, so this frame is the state, not a special case of it.
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

      test(`the day spine renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await capture(page, "today", scheme);
      });

      /**
       * **A station once a blocked diver is on the boat.**
       *
       * The station's aboard line says what the blocker *is* — a medical hold, a
       * certification this dive asks for, an unsigned waiver, money owed — and
       * one line per kind, because a count is a census and a reason is not
       * (issue #791). Nothing had ever photographed it: the seeded shop starts
       * with nobody boarded, so every capture of this surface saw the *ashore*
       * sentence, and the one a crew reads at the rail with the gate already
       * behind somebody was never looked at.
       *
       * Priya Sharma is the seeded blocked diver (waiver not sent), so boarding
       * her is the shortest honest route into the state. The reset restores the
       * schedule before the next test, which is what makes it safe to board her
       * here.
       */
      test(`a station names a blocker aboard (${scheme})`, async ({ page, request }) => {
        // **Through the trouble-states route, because it cannot be clicked.**
        // The departure checkpoint offers a blocked diver no boarding button —
        // that is the app's gate — and the after-dive head count writes a
        // different checkpoint than the station reads. In production the state
        // arises the other way round: a diver boards while clear and *then*
        // becomes blocked, because readiness is evaluated live.
        await request.post("/api/test/seed-trouble-states?blockedAboard=1");
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess: this sentence is
        // what the capture exists for.
        await page.getByText(/is aboard —/).waitFor();
        await capture(page, "today-blocked-aboard", scheme);
      });

      /**
       * **A full boat nobody has counted the crew on.**
       *
       * Every diver-shaped signal on this page says the day is going
       * perfectly, and a named crew member has no result — so somebody may be
       * on the dock, or in the water. The departure card the station replaced
       * used to celebrate here (issue #789); the line it shows instead is
       * warning-toned, and a warning nothing has photographed is one nobody has
       * looked at.
       */
      test(`a station holds back the confetti for an uncounted crew (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?crewUncounted=1");
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess.
        await page.getByText(/crew roll call is still open/).waitFor();
        await capture(page, "today-crew-uncounted", scheme);
      });

      // The nav's other door (ADR 20260813-more-is-the-shops-other-door):
      // the header's More menu holding the "Run the shop" / "Set up" groups.
      // The menu only exists from `lg` up, so this capture's 390 image is
      // deliberately the plain page — the phone door is the dock sheet below.
      test(`the header's More menu renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await page.locator("header summary").filter({ hasText: "More" }).click();
        await page
          .locator("header details[open]")
          .getByText("Run the shop", { exact: true })
          .waitFor();
        await capture(page, "nav-more-menu", scheme);
      });

      // The same groups behind the phone dock's sixth slot, as the bottom
      // sheet rising from the dock. Opened at the phone viewport because the
      // dock only exists below `lg` — the 1280 image is the plain page.
      test(`the dock's More sheet renders true to the design (${scheme})`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ })
          .waitFor();
        await page.locator("[data-dock-more]").click();
        await page.getByRole("list", { name: "Run the shop" }).waitFor();
        await capture(page, "nav-more-sheet", scheme);
      });

      // **The `blockers` capture retired with its surface.** It photographed
      // Today's by-departure view, reached through the `/blockers` redirect;
      // the shop home is one chronological spine now and that view no longer
      // exists to shoot (ADR 20260827-clearwater-surface-language, decision 4).
      // Every blocked diver it used to frame is a row on their boat's station
      // in the `today` capture above, and `day-spine.spec.ts` holds the
      // redirect to a single hop.

      // Counter mode itself — the third surface reading the shared
      // operational window (task 141). Only its walk-in sub-page had a
      // baseline before, so the queue staff actually stand in front of, and
      // the window note the three surfaces now share, went uncaptured.
      test(`counter check-in renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in");
        await page.getByRole("heading", { name: "Counter check-in", level: 1 }).waitFor();
        // The h1 is server-rendered, so it is on screen before hydration — and
        // `CheckInSearch` focuses its input from a mount effect, which paints a
        // focus ring the baseline carries. Waiting on the heading alone
        // therefore raced the ring in or out of the frame, which is what it did
        // on 2026-09-02. `data-hydrated` is set in that same effect, one line
        // after the `focus()` call, so it is the signal the page itself renders
        // for exactly this.
        await expect(page.getByLabel("Scan or search diver")).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "check-in", scheme);
      });

      // The counter's settled state, which is now a whole reading of the
      // surface rather than one row's styling: a departure that has already
      // sailed says so beside its hours, and arrives with its receipts open
      // under the count. Reached through its own chip, because the instrument
      // defaults to the next boat still to sail. Reading the seeded state keeps
      // this capture independent of the mutable check-in action while the
      // functional spec covers the toggle itself.
      //
      // **No earned line in this frame, and that is the point of it.** Every
      // diver on this boat is `checked_in`, which used to be the whole
      // condition for the counter's one coral moment (ADR
      // 20260827-clearwater-surface-language, decision 11) — so the shipped
      // capture showed the instrument painting all-clear over three divers
      // readiness will not clear. What it holds now is the honest reading: a
      // red band on the meter, "3 divers can't board yet", and those three
      // still out in the working list with their badges and their reasons. The
      // coral moment itself is pinned by `CounterInstrument.test.tsx`, which
      // can put a genuinely clear boat in front of it.
      test(`counter check-in's settled boat renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/check-in");
        await page
          .getByRole("navigation", { name: "Choose a departure" })
          .getByRole("link", { name: /Dawn Two-Tank — Molasses Reef/ })
          .click();
        await page.getByRole("heading", { name: /^Checked in — \d+$/ }).waitFor();
        // Same frame, same search box, same race — this one simply has not lost
        // it yet.
        await expect(page.getByLabel("Scan or search diver")).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "check-in-checked", scheme);
      });

      // **The home's evening reading** (ADR 20260804-day-closeout, folded into
      // the home by 20260827-clearwater-surface-language's decision 4). The
      // ritual that ends every working day is a *state* the spine settles
      // into, so the surface to photograph is the shop home once every station
      // has settled: the closing stations with their marks and head counts,
      // the leftovers group with a Dismiss per row, and the one closing act.
      //
      // `seed-evening` moves the demo day's departures behind the frozen clock
      // rather than moving the clock, which is one process-wide value shared
      // by the server, the seed and the browser (`e2e/servers.ts`). Two shots
      // in one test because the second state only exists after the first one's
      // write — the recorded close, which is coral when nothing was left open
      // and flat when something was (issue 761).
      test(`the home's evening renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        // A seed write, two full-page shots, and the close round trip.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await request.post("/api/test/seed-evening");
        await page.goto("/shop/blue-mantis");
        await page.getByText("Still open — carries to tomorrow").waitFor();
        await capture(page, "today-evening", scheme);

        await page
          .getByRole("button", { name: /^Close the day( again)?$/ })
          .first()
          .click();
        await page.getByText(/Closed by Dana Reyes at/).waitFor();
        await capture(page, "today-evening-closed", scheme);
      });

      // Staffing as a week (ADR 20260827-the-shops-shelves, decision 3):
      // people down the side, seven shop-local days across the top, shifts as
      // quiet chips, credentials as a ledger beneath. The demo's own week,
      // gap row included — the seeded board carries the departure whose
      // divemaster is driving it (`seed-trips.ts`, the DOM-M3 case), which
      // Today already reports as uncrewed and this surface now agrees with.
      // Its 390 image is the day list, which is what the week collapses to
      // below `lg` (the same call H-63 made for the board).
      test(`the staffing week renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/staffing");
        await page.getByRole("heading", { name: "Staffing", level: 1 }).waitFor();
        await capture(page, "staffing", scheme);
      });

      /**
       * A second, louder day: a departure the shop *had* crewed and no longer
       * has, rendering in its own day cell with the warning word and the
       * Assign door beside it. It is not seeded into blue-mantis — a demo
       * permanently short-handed is a worse demo, the same call
       * `seed-front-desk.ts` makes about its `succeeded` payment — so it comes
       * from `/api/test/seed-trouble-states?crewGap=1`, opt-in because pulling
       * a crew off a boat moves Today's queue and every crew count in the
       * fleet.
       */
      test(`the staffing week carries a crew gap in its day (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?crewGap=1");
        await page.goto("/shop/blue-mantis/staffing");
        // The destination's own words, not a timing guess.
        await page.getByText("No crew").first().waitFor();
        await capture(page, "staffing-week-gap", scheme);
      });

      // The fast walk-in flow, both halves: pick today's boat, then search or
      // hand-enter a diver — no trip page detour, no required email at the
      // counter. Two captures and two tests, for the same reason the
      // Add-booking door below has two: the picker and the diver form never
      // share a screen, so one shot would leave half the surface with no
      // baseline at all.
      test(`the walk-in counter renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in/walk-in");
        await page.getByRole("heading", { name: "Walk-in", level: 1 }).waitFor();
        await capture(page, "check-in-walk-in", scheme);
      });

      test(`the walk-in picker explains an invalid submission (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in/walk-in?notice=walkin-invalid");
        await expect(page.getByRole("alert").filter({ hasText: "Choose a boat" })).toBeVisible();
        await capture(page, "check-in-walk-in-notice", scheme);
      });

      test(`the walk-in diver step renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/check-in/walk-in");
        await page.getByRole("heading", { name: "Walk-in", level: 1 }).waitFor();
        // Scoped to the picker's own section, the same way check-in.spec.ts
        // reaches this step. A page-wide match on the departure's *name* is how
        // this first landed, and a title regex loose enough to catch whatever
        // boat the seed puts first also catches the "Divers" nav tab — which is
        // a link, contains "Dive", and comes first in the DOM.
        const tripSection = page.locator("section").filter({ hasText: "Which boat?" });
        await tripSection.locator("ul li a").filter({ visible: true }).first().click();
        await page.waitForURL(/\/check-in\/walk-in\/[^/?]+$/);
        await page.getByRole("link", { name: "Add diver", exact: true }).click();
        await page.waitForURL(/\/divers\/new/);
        await page.getByRole("heading", { name: "Add a diver", level: 1 }).waitFor();
        await capture(page, "check-in-walk-in-diver", scheme);
      });

      // The global Add-booking door, both halves: the departure picker — one
      // ledger grouped by day since slice 9g of ADR
      // 20260827-the-shops-shelves, seats-left on every row — and the diver
      // step once a boat is chosen (returning-diver search + hand entry). Two
      // captures and two tests — the picker and the diver form never share a
      // screen, so one shot would leave half the surface with no baseline at
      // all, and one *test* would let a broken picker take the diver form's
      // baseline with it.
      test(`the Add-booking departure picker renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        // The day headings are the composition; wait for the first one rather
        // than for the h1, which paints with the static shell.
        await page.getByRole("heading", { level: 3 }).first().waitFor();
        await capture(page, "booking-new", scheme);
      });

      test(`the Add-booking diver step renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        // The whole row is the door and its accessible name is the departure's
        // title — the seats-left fact rides beside it rather than inside the
        // link, so it is the row that is clicked here.
        //
        // **Scoped to the picker.** This page opens with "Relevant requests"
        // above the departures, and those rows are `<li>`s too — so an
        // unscoped `listitem` query took the first *date request*, whose link
        // is `?request=<id>` on this same page and can never satisfy the
        // `waitForURL` below. The capture then burned its whole budget and
        // took the shard down with it, which is worse than a wrong picture:
        // reg-suit skips its compare when a shard fails and reports green over
        // nothing compared.
        await page
          .getByRole("region", { name: "Which departure?" })
          .getByRole("listitem")
          .first()
          .getByRole("link")
          .first()
          .click();
        await page.waitForURL(/\/bookings\/new\/[^/?]+$/);
        await page.getByRole("link", { name: "Add diver", exact: true }).click();
        await page.waitForURL(/\/divers\/new/);
        await page.getByRole("heading", { name: "Add a diver", level: 1 }).waitFor();
        await capture(page, "booking-new-diver", scheme);
      });

      /**
       * **Wait for the list's own tail, not just the shell.**
       *
       * The board is `instant = true` with a `loading.tsx`, so its departures
       * arrive by PPR streaming *after* the heading these shots used to gate on.
       * That is the same race this file already documents for the public
       * schedule ("two runs catching different skeleton frames is what produced
       * the schedule-dark diffs on builds with no code change") — and it came
       * back here: `schedule-builder-add-dark-vw-390` reported changed on a PR
       * that touches neither the board nor anything it renders, and the whole
       * difference was 168px of missing tail with "Show later departures" in it.
       * One variant out of four, which is what a race looks like and what a code
       * change does not.
       *
       * The pager is the last thing the list paints, so waiting for it proves
       * the stream finished. It is stable: the seeded board always holds more
       * departures than one keyset page.
       *
       * **Attached, and by attribute.** From `xl` up the day stream is
       * `display:none` behind the week grid, the pager with it — so a wait for
       * it to be *visible* is a wait for something that is never coming, and
       * three board captures spent their whole 184s budget on it. Both
       * compositions arrive in the same streamed payload, so the pager being in
       * the DOM proves the tail landed whichever one the width paints. The role
       * query cannot express that: `e2e/fixtures.ts` appends
       * `.filter({ visible: true })` to every one of them, which is visible in
       * the CI call log and which silently discards `includeHidden`.
       * `page.locator` is the query it leaves alone.
       */
      const boardListSettled = (page: Page) =>
        page.locator("a[data-board-pager='next']").waitFor({ state: "attached" });

      /**
       * **Prove the add panel is open before photographing it — every other
       * gate this capture has is equally true of the board with it shut.**
       *
       * `schedule-builder-add` used to gate on the placeholder `<option
       * disabled>` inside `select[name="courseId"]` detaching, which is the
       * right signal that the panel's own fetch has landed and the shot will
       * not be of "Loading…". It is the wrong signal for whether the panel
       * exists: Playwright resolves `state: "detached"` **immediately** for a
       * locator matching nothing, and before the panel mounts there is no
       * `select[name="courseId"]` at all. The gate was therefore true at
       * exactly the moment it was meant to be false, and the capture's two
       * other gates cannot tell the pages apart — the `Board` heading and the
       * board's trailing pager render identically either way.
       *
       * Measured rather than reasoned. Instrumenting `capture()` to log
       * `location.href` beside `document.documentElement.scrollHeight`, a
       * `--repeat-each=5` run caught `schedule-builder-add` shooting
       * `/schedule/board` with no `?add=` twice, at 3,828px — the
       * `schedule-builder` baseline's own height, the same page — against
       * 4,986px on `/schedule/board?add=1`. The click's client navigation had
       * simply not committed, and nothing waited for it. The old gate also
       * admitted a half-settled panel at 4,818px, the 168px that made this
       * look like a pager appearing and disappearing.
       *
       * It is not the pager. The trailing "Show later departures" control was
       * present in every probe of both runs, and the demo shop seeds 48
       * upcoming departures against a 14-row keyset page, so `nextCursor` is
       * never null and the control is never conditional. With the gates below,
       * 20 consecutive captures measured 4,986px and 3,136px, every one.
       */
      const addPanelSettled = async (page: Page) => {
        // The click's client navigation has committed. Every other gate below
        // — and both of this capture's outer ones — is equally true of the
        // *pre-click* board, so this is the only one that can tell the two
        // pages apart. A no-op for the expanded capture, which `goto`s the
        // panel state directly.
        await page.waitForURL(/[?&]add=/);
        const courseSelect = page.locator('select[name="courseId"]');
        // The panel is mounted. Without this the wait below is vacuous.
        await courseSelect.waitFor({ state: "attached" });
        // `loadBuilderOptionsAction` has answered. One select speaks for both:
        // the two placeholders are driven by the same `options === null`, and
        // the dive-site select is `hidden` in the expanded panel, where a wait
        // on its visibility would never resolve.
        await courseSelect.locator("option[disabled]").waitFor({ state: "detached" });
      };

      // The staff schedule as a builder: departures grouped by day, each row
      // carrying its crew and one quiet "⋯" disclosure for move/copy/remove.
      test(`the schedule board renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await boardListSettled(page);
        await capture(page, "schedule-builder", scheme);
      });

      /**
       * **The move panel with its impact preview** (issue #1203, D43).
       *
       * The one seeded departure that has consequences worth stating: the
       * Spiegel Grove wreck trip carries the demo's only booking confirmations
       * and its reserved gear, so this photographs the block populated rather
       * than the empty case every other row shows. That every other row shows
       * nothing is the point of the feature and is covered by unit tests; a
       * capture of an absent block would be a capture of the board.
       *
       * Gated on the block's own heading, which only renders once the panel's
       * read has landed — the preview is fetched when the panel opens, so the
       * `Board` heading and the pager are both true before it exists.
       *
       * **Opened at the phone width on purpose.** The board has two
       * compositions — the vertical day stream below `xl`, the week grid at and
       * above it — and they key their panels separately (`move:` against
       * `w:move:`), so whichever one is open closes when `capture()` resizes
       * through the other. `MovePanel` is module scope and shared by both, so
       * one composition covers the component either way; the narrow column is
       * the half worth photographing, because a block of prose stacked above a
       * two-field form is where crowding would show. The 1280 sibling is
       * therefore the plain week grid.
       */
      test(`the move panel says what a move will cost (${scheme})`, async ({ page }) => {
        const title = "Wreck Trip — Spiegel Grove";
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) })
          .first()
          .click();
        await page
          .getByRole("button", { name: new RegExp(`^Move ${title},`) })
          .first()
          .click();
        await page.getByText("If you move it").waitFor();
        await capture(page, "schedule-builder-move-impact", scheme);
      });

      // The add-a-departure form as a shop meets it all week: the quick path,
      // which the board only ever shows as a button — every field a departure
      // is born with, price included, with the rare half collapsed behind
      // "More options".
      test(`the add-a-departure panel renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
        await page.getByRole("link", { name: "Add a departure", exact: true }).click();
        await addPanelSettled(page);
        await boardListSettled(page);
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
        await addPanelSettled(page);
        await boardListSettled(page);
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
        await openTripAbout(page);
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

      // The roster — the front desk's densest everyday surface, and now one
      // ledger at every width: letter groups, a name per row, and a badge only
      // where something is exceptional (ADR 20260827-people-not-lists).
      // Wait for the roster itself, not the skeleton: same race as the public
      // schedule, and the one that put a half-drawn loading state into the
      // divers-light baseline.
      test(`the diver roster renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("searchbox", { name: "Search divers" }).waitFor();
        // The search row is a box *and* a button now, both from first paint
        // (issue #782). Waiting for only half of it is how a baseline ends up
        // holding a row that is still assembling.
        await page.getByRole("link", { name: "Add diver" }).waitFor();
        // ...and the ledger under it: the first letter group is what the
        // skeleton's grey bars stand in for, so this is the wait that keeps the
        // capture off the loading state.
        await page.locator("main ul li").first().waitFor();
        await capture(page, "divers", scheme);
      });

      /**
       * The form the front desk fills in most often, and the one the command
       * palette's create flow lands on. Four specs reach it and none of them
       * had ever looked at it: `check:route-coverage` counted an e2e spec as
       * coverage and passed silently (issue #727). Forms are where visual
       * regressions hide — alignment, the `Field`/`FieldGrid` wrappers, the
       * shape of an optional-vs-required row.
       */
      test(`the add-diver form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await capture(page, "divers-new", scheme);
      });

      // The roster's one view that leaves the active list behind: where a
      // deleted diver can be found and restored, once the undo toast is long
      // gone. The demo shop deletes nobody, so this photographs the view's own
      // chrome — the chip row with "Deleted" on it, the line saying what the
      // view holds, and the way back out.
      test(`the deleted-divers view renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers?filter=removed");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("link", { name: "Deleted", exact: true }).waitFor();
        await capture(page, "divers-removed", scheme);
      });

      /**
       * **One diver's whole record**, in the composition ADR
       * 20260827-people-not-lists gave it: masthead, status ledger, story, and
       * the file as inset groups. Priya is the diver `seed-diver-trail.ts`
       * gives a trail past one page to, so the folded Activity group is real
       * here.
       */
      test(`a diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        // The story is the second thing on the page and the widest — waiting
        // on it rather than on the h1 keeps the shot off a half-assembled
        // record.
        await page.getByRole("region", { name: "The story" }).waitFor();
        await capture(page, "diver-profile", scheme);
      });

      /**
       * **The record with nothing outstanding** — the state the design is
       * really about, and the one a seeded demo never shows: every seeded
       * diver has a card, a signature or a balance waiting on somebody. The
       * status section renders *nothing at all* here, which is the pinned rule
       * (`_lib/status.test.ts`), and this is the only baseline that can catch
       * a heading or an "all clear" line creeping back in above the story.
       *
       * Built rather than seeded: a fresh diver has no cards, no bookings and
       * no orders, so the only thing left is the release and the emergency
       * contact, and the details form takes both. Safe to mutate — every
       * worker owns its database and resets before each test.
       */
      test(`a clear diver's record renders true to the design (${scheme})`, async ({ page }) => {
        // Deterministic, not `Date.now()`: the name renders in the h1, the
        // email line, the earned-moment banner and the delete button, so a live
        // stamp made this capture differ on every run. The reset before each
        // test purges every non-staff person, so the fixed identity is free.
        const name = "Clear Diver";
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await page.getByLabel("Full name").fill(name);
        await page.getByLabel("Email").fill("clear-diver@example.com");
        await page.getByRole("button", { name: "Add diver", exact: true }).click();
        await page.getByRole("heading", { level: 1, name }).waitFor();
        // The roster's add form lands here with the details editor open.
        await page.getByLabel("Emergency contact name").fill("Kojo Mensah");
        await page.getByLabel("Emergency contact phone").fill("+13055550177");
        await page.getByRole("button", { name: "Save details" }).click();
        // Land the save before touching the Waiver group. The save redirects and
        // the record re-renders around the notice it carries, which is what left
        // the paper-waiver button "not stable" and then "detached from the DOM"
        // mid-click. Reloading is the deterministic settle — a record at rest,
        // with its disclosures closed — rather than a wait on a moving page.
        await page.reload();
        await page.getByRole("heading", { level: 1, name }).waitFor();
        // Click the summary, exactly as `waivers.spec.ts` does against this same
        // markup — `exact`, because "Send options" without it also matches the
        // container that holds the summary, and clicking a container opens
        // nothing. Waiting on the summary instead of clicking it is the older
        // trap: it proves the disclosure exists while the paper-waiver control
        // inside stays hidden, and the capture then times out on the button.
        await page
          .getByRole("region", { name: "Waiver" })
          .getByText("Send options", { exact: true })
          .click();
        await expect(page.getByRole("button", { name: "Mark signed on paper" })).toBeVisible();
        await page.getByRole("button", { name: "Mark signed on paper" }).click();
        await page
          .getByLabel("I have this diver's signed release on file", { exact: false })
          .check();
        await page.getByRole("button", { name: "Record paper signature" }).click();
        // The earned moment is what says the ledger emptied — and it is the
        // page's one coral element (20260827-clearwater-surface-language,
        // decision 11).
        await page.getByText("That was the last thing").waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-record-clear", scheme);
      });

      /**
       * **The form that ends a medical hold** (issue #1252).
       *
       * The one readiness blocker a shop cannot clear from the boat, and until
       * this landed there was no form to photograph at all — the Waiver group
       * rendered nothing for a hold. It asks for the physician's evaluation
       * date and either their name or the form itself, so what is on screen is
       * three fields a staffer fills while somebody stands at the desk holding
       * a letter. The demo's Morgan Vale carries the synthetic hold.
       */
      test(`the physician-clearance form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers?q=Morgan");
        await page.getByRole("link", { name: "Morgan Vale" }).click();
        await page.getByRole("heading", { level: 1, name: "Morgan Vale" }).waitFor();
        await page.getByRole("button", { name: "Record physician clearance" }).click();
        // The submit is what the disclosure reveals, so waiting on it is
        // waiting on the panel being open rather than on a duration.
        await page
          .getByRole("button", { name: "A physician cleared this diver to dive" })
          .waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-medical-clearance-form", scheme);
      });

      /**
       * The explicit duplicate-resolution surface: create a second record for
       * a seeded diver, then photograph the owner/manager's survivor choice.
       * This keeps the warning, match reasons, radio controls, and one primary
       * merge action in the visual suite without making the demo seed itself a
       * duplicate. The per-test reset removes the temporary record afterward.
       */
      test(`a possible duplicate record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await page.getByLabel("Full name").fill("Priya Sharma");
        await page.getByLabel("Email").fill("priya.duplicate@example.com");
        await page.getByLabel("Phone").fill("+1 305 555 0999");
        await page.getByRole("button", { name: "Add diver", exact: true }).click();
        await page
          .getByRole("heading", {
            name: "Did you mean one of these existing potential matches?",
          })
          .waitFor();
        await page.getByRole("button", { name: "Create new diver anyway" }).click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        await page.getByRole("heading", { name: "Possible duplicate records" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-merge", scheme);
      });

      /**
       * **The record of a diver who has been deleted**, which is the only place
       * "Erase personal data" is offered at all (ADR 20260802-diver-data-erasure,
       * 2026-08-21 amendment). Two things this is the sole baseline for: the
       * warning-toned Restore card at the top, and the destructive tail at the
       * bottom — the one control in the product with no undo, in the one state
       * it renders in.
       *
       * Deletes a diver rather than seeding one, because the demo shop should
       * not permanently carry a deleted person: the roster's own "Deleted" view
       * is photographed next door on its *empty* chrome, and a resident deleted
       * diver would quietly change that capture too. Safe to mutate — every
       * Playwright worker owns its database and resets the schedule before each
       * test, which puts Felix back.
       */
      test(`a deleted diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Felix", "Felix Grant");
        const record = page.url().split("?")[0] ?? "";
        await page.getByText("Delete Felix Grant").click();
        await page.getByRole("button", { name: "Delete diver" }).click();
        await page.getByText("Diver deleted.").waitFor();
        await page.goto(record);
        // The two ends of the page this capture exists for, waited on by name
        // so the shot can never land on a half-rendered record.
        await page.getByText("This diver is deleted").waitFor();
        await page.getByRole("heading", { name: "Erase personal data" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-deleted", scheme);
      });

      /**
       * The waiver card with its paper attestation open — the one state on this
       * record that no baseline had ever looked at, because it used to live
       * behind a `<details>` that only opens on a click.
       *
       * It is worth its own capture rather than a note on `diver-profile`:
       * these are the four ways a shop gets a release signed, they have to read
       * as one control group at both widths, and the panel that drops out of
       * that row carries the medical attestation a staffer is putting their
       * name to. A row that wraps badly or a panel that reads as a different
       * kind of object is exactly the drift a screenshot catches and a
       * functional assertion cannot.
       */
      test(`the waiver card's paper attestation renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await page.getByRole("region", { name: "Waiver" }).getByText("Send options").click();
        await page.getByRole("button", { name: "Mark signed on paper" }).click();
        // The panel itself, not the trigger that opened it — so the capture can
        // never photograph the row mid-swap.
        await page.getByRole("button", { name: "Record paper signature" }).waitFor();
        await capture(page, "diver-profile-paper-waiver", scheme);
      });

      /**
       * The same delivery row on a day when one of the ways failed: each button
       * wearing what we last knew about *its own* channel — a refused email
       * beside a text that landed.
       *
       * Test-only for the reason the whole trouble-states route exists: a
       * delivery outcome needs a provider, the demo shop has none, and seeding
       * a permanent failure would make the calm capture next door a lie. The
       * ring is colour and the mark beside it is a shape, so this is also the
       * only baseline that can catch the two drifting apart.
       */
      test(`a waiver's per-channel delivery states render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await page.getByRole("region", { name: "Waiver" }).getByText("Send options").click();
        // The ringed button itself, so the capture can never land before the
        // server data that rings it has arrived.
        await page.getByRole("button", { name: /Email waiver/ }).waitFor();
        await page.getByText("Didn’t go out").waitFor({ state: "attached" });
        await capture(page, "diver-profile-waiver-delivery", scheme);
      });

      /**
       * The diver record on the day somebody says they hold no card: a
       * warning-toned correction panel, not a certification row. The state is
       * test-only because the demo shop should not permanently claim that a
       * healthy diver is uncertified; the seed route also makes the staff
       * eraser available to the functional flow.
       */
      test(`a diver's no-card declaration renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await openDiverProfile(page, "Nadia", "Nadia Petrov");
        await page.getByText("Not certified yet — unverified").waitFor();
        await capture(page, "diver-profile-not-certified", scheme);
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
        await openDiverProfile(page, "Hana", "Hana Kobayashi");
        await capture(page, "diver-profile-imported", scheme);
      });

      /**
       * A diver who has actually paid for something. None of the three
       * profiles above carries a single order row — verified against the
       * seed, not assumed — so the money facts on the story's rows had only
       * ever been photographed absent. Talia Rosen is the seed's heaviest
       * payer, so this is the widest version of the ledger.
       *
       * Deliberately a fourth capture rather than a repoint of
       * `diver-profile`: Priya's profile is the baseline for the *other*
       * states on that page, and moving it would trade one blind spot for
       * another.
       *
       * What this still does NOT cover, and why: a story row for an order
       * with `bookingId === null` — a standalone shop payment, which renders
       * as its own row pointing at the order. Every seeded order is generated
       * from a booking, so that branch is unreachable from the demo data. It
       * stays covered by `DiverStory.test.tsx` alone.
       */
      test(`a paying diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Talia", "Talia Rosen");
        // The money facts ride the story's rows now — Payments, Upcoming and
        // Shop history folded into one ledger.
        await page.getByRole("region", { name: "The story" }).waitFor();
        await capture(page, "diver-profile-payments", scheme);
      });

      // The seeded reef trip's three surfaces — Trip (what the departure is and
      // who is coming), Manifest (the day-of boarding + roll call), and Prep
      // (the morning packing list). They share a layout that streams a
      // skeleton while the page's data loads, so every capture waits for real
      // content — never the loading fallback — before shooting. One test each:
      // they used to be four consecutive stops on one tour, which meant a
      // renamed heading on Trip cost the manifest its baseline too.
      test(`a trip's Trip surface renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        await capture(page, "trip-manage", scheme);
      });

      /**
       * The other Overview: a departure that only runs with enough people and
       * has not got them yet (ADR 20260813-minimum-head-count-departures). The
       * reef trip above names no minimum, so its baseline can never show this
       * band — and the band is the one surface in the feature a shop reads
       * every day, in the window where ringing round the regulars still saves
       * the departure. The fixture is seeded four days out with a 48-hour
       * window (src/db/seed-minimum-seats.ts), so against the fleet's frozen
       * clock it photographs the *short* state, not the red about-to-cancel
       * one — deliberately, since short is the state staff can act on.
       */
      test(`a short departure shows its minimum head count (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, MINIMUM_SEATS_TRIP);
        await page.getByRole("heading", { name: /divers short of the/ }).waitFor();
        await capture(page, "trip-minimum-seats", scheme);
      });

      test(`a trip's Trip roster renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Trip");
        await page.locator("#roster").waitFor();
        await page.locator("#add-diver").waitFor();
        await capture(page, "trip-guests", scheme);
      });

      /**
       * **The list, before the send** (FU-20260813,
       * ADR 20260814-self-declared-cards).
       *
       * `trip-guests` above can never show this: the deal panel lives behind a
       * collapsed disclosure, and it renders nothing at all until somebody is
       * on the shop's last-minute list. What it photographs is the one thing
       * standing between a shop and a discount emailed to a diver who cannot
       * board — the recipient's level, marked self-declared, in the row above
       * the send button. If that mark ever stops reading as weaker than a
       * certified card, this is the baseline that catches it; nothing else in
       * the suite looks at the two treatments side by side.
       *
       * Seeded through the real public form rather than a fixture, because the
       * claim's whole journey — anonymous post to staff panel — is the thing
       * under test. Safe to mutate: each worker owns its own database and
       * resets before every test (e2e/servers.ts).
       */
      test(`the deal panel shows who it would reach (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis");
        const dealList = page.locator("#last-minute-list");
        await dealList.locator("summary").click();
        await dealList.getByLabel("Name").fill("Tess Alvarez");
        await dealList.getByLabel("Email").fill("tess.visual@example.com");
        await dealList.getByLabel("Certification level").selectOption("open_water");
        await expect(dealList.getByLabel("I'm certified for nitrox (enriched air)")).toHaveCount(0);
        await page
          .locator('input[name="availableFrom"]')
          .filter({ visible: true })
          .fill("2020-01-01");
        await page.getByRole("button", { name: "Notify me" }).click();
        await page.getByRole("heading", { name: "You’re on the list." }).waitFor();

        // Already signed in: `signedInAsOwner()` is describe-scoped over this
        // block, which is also why the public form above renders with the staff
        // preview bar. Neither affects the surface being photographed.
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        // The `#last-minute-deal` anchor is what auto-opens the disclosure.
        await page.goto(`/shop/blue-mantis/trips/${tripId}#last-minute-deal`);
        await page.getByText("Open Water — unverified").waitFor();
        await capture(page, "trip-guests-deal-recipients", scheme);
      });

      /**
       * **The same panel when nobody is eligible.**
       *
       * The reef departure is raised to Rescue first — the highest rung a trip
       * may demand since #630 capped requirements at the recreational ladder
       * (`REQUIRABLE_CERTIFICATION_LEVELS`, src/lib/readiness.ts). The newly
       * added no-certification and Open Water joiners are then filtered out of
       * the send list instead of being shown with a warning that could be
       * overlooked.
       */
      test(`the deal panel weighs the list against the bar (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const join = async (name: string, email: string, level?: string) => {
          await page.goto("/s/blue-mantis");
          const dealList = page.locator("#last-minute-list");
          await dealList.locator("summary").click();
          await dealList.getByLabel("Name").fill(name);
          await dealList.getByLabel("Email").fill(email);
          if (level) await dealList.getByLabel("Certification level").selectOption(level);
          await page
            .locator('input[name="availableFrom"]')
            .filter({ visible: true })
            .fill("2020-01-01");
          await page.getByRole("button", { name: "Notify me" }).click();
          await page.getByRole("heading", { name: "You’re on the list." }).waitFor();
        };
        // The optional question, skipped — the common answer on a marketing
        // opt-in, and the one a shop can weigh least.
        await join("Wes Toledo", "wes.visual@example.com");
        await join("Tess Alvarez", "tess.visual@example.com", "open_water");

        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await page.getByText("Edit requirements", { exact: true }).click();
        await page.getByLabel("Minimum certification").selectOption("rescue");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar mid-season strands the divers already booked under
        // the old one, so the save answers with its warning variant ("8 booked
        // divers no longer meet them") rather than the plain confirmation.
        // Matching the stem keeps this test about the deal panel.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        await page.goto(`/shop/blue-mantis/trips/${tripId}#last-minute-deal`);
        await page.getByRole("heading", { name: "Nobody to send this to yet" }).waitFor();
        await capture(page, "trip-guests-deal-below-requirement", scheme);
      });

      /**
       * **The same panel with nobody's help — the demo shop exactly as it is
       * seeded** (FU-20260815-no-seeded-diver-ever-declared-anything).
       *
       * The two captures above each drive the public form first, so what they
       * photograph is a claim this test just made. Until 2026-08-15 that was the
       * *only* way any of these marks had ever been rendered outside jsdom: no
       * seeded diver had declared anything, so every name on blue-mantis's
       * last-minute list read "Level not said" — the one branch that carries no
       * mark and no tone — and a shop clicking through the demo saw a clean list
       * where a real one has two rows worth pausing over.
       *
       * `src/db/seed-self-declared.ts` puts them there, and this is the baseline
       * that proves the eligible declaration arrives: Rowan Feld's level and
       * enriched-air claims each carry their own unconfirmed mark. Selah Mbeki,
       * who has no certification declaration, is correctly absent from the
       * send list.
       *
       * The night charter still carries both seeded joiners, while Selah also
       * starts today so the headline reef departure has one marked row when a
       * demo visitor opens it. Rowan remains tomorrow-only, keeping that first
       * list realistic rather than alarming.
       */
      test(`the deal panel carries the demo's own declarations (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", "Night Dive — City of Washington");
        await page.goto(`/shop/blue-mantis/trips/${tripId}#last-minute-deal`);
        await page.getByText(/Open Water — unverified/).waitFor();
        await capture(page, "trip-guests-deal-seeded", scheme);
      });

      /**
       * **The other list on the same page, and the first baseline it has ever
       * had** (ADR 20260814-self-declared-cards, the 2026-08-15 amendment).
       *
       * The wait list renders only when somebody is on it, so `trip-guests`
       * above — pinned to the reef morning — can never show it. The seeded
       * wait-lister is on the Pickles Reef charter and holds a **verified** Open
       * Water card, which is exactly the row worth photographing once the
       * departure is raised to Advanced Open Water: calm, muted, nobody's claim
       * in doubt, and under the bar. The tone is the deal panel's answer to "has
       * anybody seen this card?" and must stay that; if it ever warms here, this
       * is the baseline that catches it.
       *
       * The Invite button beside the name is in the frame deliberately. Nothing
       * about this mark filters the list, reorders it, or disables the invite —
       * a wait list is leads in the order they asked (ADR
       * 20260813-wait-list-is-a-lead-list) and informing the staffer is the whole
       * design.
       */
      test(`the wait list weighs a lead against the bar (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Pickles Reef");
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await page.getByText("Edit requirements", { exact: true }).click();
        await page.getByLabel("Minimum certification").selectOption("advanced_open_water");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar on a seated charter answers with the warning variant
        // ("… booked divers no longer meet them"); matching the stem keeps this
        // test about the wait list.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        await page.goto(`/shop/blue-mantis/trips/${tripId}#waitlist`);
        // Scoped to the ledger: the deal panel further down the same page
        // renders the identical phrase for its own recipients, and this test is
        // about the list that was still silent until now. (`#waitlist` is the
        // group's band heading, not an ancestor of its rows — the rows are the
        // band's sibling list, so the section is the narrowest honest scope.)
        await page
          .locator("#roster")
          .getByText("Open Water · below this departure's minimum")
          .waitFor();
        await capture(page, "trip-guests-waitlist", scheme);
      });

      test(`a trip's manifest renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        // The offline safety copy now saves itself in the background on
        // mount; wait for that to settle (the offline-roll-call link only
        // renders once saved) so the capture isn't racing that async write.
        await offlineCopySaved(page);
        // The push opt-in and the boat-mode control both decide what to render
        // *after* mount, and both now live inside the collapsed "On this phone"
        // group (ADR 20260827-the-departure-is-two-working-surfaces, decision
        // 2) — so neither can change this capture's picture, and waiting on
        // them would only be waiting. The freshness pill above is the one piece
        // of that group's state on the summary line, and it is what this shot
        // must not race.
        await capture(page, "manifest", scheme);
      });

      // The departure log: the hand-to-authorities document of the
      // departure's recorded facts (roster with roll-call state, evidence and
      // waiver status, timeline, integrity code). Captured on the seeded reef
      // trip before any roll call, so the baseline shows the stated-absence
      // rendering — "Awaiting" cells, an explicitly empty timeline — which is
      // exactly the state that must never read as a blank on this document.
      test(`a trip's departure log renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const tripPath = new URL(page.url()).pathname;
        await page.goto(`${tripPath}/log`);
        await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
        await capture(page, "departure-log", scheme);
      });

      // The same document at its widest. The roster and crew tables are three
      // columns plus one per roll-call checkpoint, and a checkpoint is a dive,
      // so the reef trip's two dives photograph six columns and nothing in this
      // suite had ever looked at more. Four dives is the ceiling the schedule
      // form and the `trips_planned_dives_range` check constraint both enforce,
      // and it is eight columns — the case issue #1052 widened the floor for.
      // Captured at the portrait tablet as well (`TABLET_SURFACES`), because
      // that width is where issue #1035 found the crush this inherits.
      test(`a departure log at every checkpoint renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto(await deepDiverLogPath(page));
        await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
        await capture(page, "departure-log-every-checkpoint", scheme);
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

      // The same packing list read down the roster instead of down the rack:
      // one row per diver with their pieces, including the divers who have
      // nothing to pull. Reached through the switch itself rather than a typed
      // `?group=diver`, so the capture also proves the control sits where a
      // packer would look for it and that the flip keeps the page in place.
      test(`a trip's prep list groups by diver (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Prep");
        await page.getByRole("link", { name: "By diver" }).click();
        // The by-item grouping has no Diver column, so this cannot resolve
        // against the view that was on screen a moment ago.
        await page.getByRole("columnheader", { name: "Diver" }).waitFor();
        await capture(page, "prep-by-diver", scheme);
      });

      // The prep page's rental-assignments panel in its lived-in state: the
      // wreck trip ships with seeded units already assigned (seed-gear.ts),
      // so the frame holds assigned chips with their Release taps beside
      // open pickers — the grammar the reef trip's all-unassigned capture
      // above can't show (ADR 20260815-minimal-gear-register).
      test(`the prep page's rental assignments render true to the design (${scheme})`, async ({
        page,
      }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
        await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
        await page.getByRole("heading", { name: "Rental assignments" }).waitFor();
        await capture(page, "prep-assignments", scheme);
      });

      // The slip the counter prints and hands over. Reached the way a staffer
      // reaches it — through the assignment row's own door, not a typed URL —
      // so the capture also proves the door appears for a diver who has units
      // on them.
      test(`a diver's rental ticket renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
        await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
        await page.getByRole("link", { name: "Rental ticket" }).first().click();
        await page.getByRole("heading", { name: "What you have" }).waitFor();
        await capture(page, "rental-ticket", scheme);
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
        await offlineCopySaved(page);
        await settleOfflineShellWorker(page);
        await page.goto("/offline-manifest");
        await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
        await capture(page, "offline-manifest-list", scheme);
      });

      /**
       * The same list with one copy no longer current — the only state on it
       * that carries a pill at all.
       *
       * The baseline above photographs the calm case, where every row is
       * current and nothing is badged; before 2026-08-23 that case badged all
       * four rows green and this one was indistinguishable from it at a glance
       * (issue #816). That is the whole reason this frame exists separately:
       * the change is only worth anything if the exceptional row is louder than
       * the ordinary ones, and no capture could show that while they looked the
       * same. Both the row's pill and the group line at the top move here and
       * nowhere else.
       */
      test(`an offline copy needing a refresh renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { savedAt: AGING_SAVED_AT });
        // The tenant lookup is still refused from `savedOfflineRecordFor`, so
        // no cross-shop purge re-reads the record underneath this reload and
        // the row paints from exactly what was just written.
        await page.reload();
        await page.getByText("Saved 2 hours ago").waitFor();
        await capture(page, "offline-manifest-list-needs-refresh", scheme);
      });

      /**
       * The saved copy actually *opened* — the roll call a crew member works
       * with no signal, which until now had no baseline of any kind. The four
       * other offline captures photograph the shell's states around it (the
       * list, nothing-saved, discarded, another shop's), and none of them
       * contains a diver row, so every control on the surface a boat falls back
       * to was uncovered: the roster, the per-diver note disclosure, the
       * board/not-boarded pair, the freshness pill. Found by a 2026-08-11 change
       * that restyled the note disclosure here and moved no pixels in any
       * baseline.
       */
      test(`the offline roll call renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the saved copy.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        // The roster is what proves the record was read back and decrypted —
        // the shell renders its chrome before the store resolves.
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await capture(page, "offline-manifest-roll-call", scheme);
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

      /**
       * The address card, open — one search box and the address it found (ADR
       * 20260811-address-is-one-search-box). It earns its own capture because
       * the row is closed in `settings-payments`, so the shape that replaced
       * five text boxes and a Save button is otherwise never looked at.
       *
       * The fleet configures no `PLACES_AWS_*` credentials, so this captures
       * the unconfigured state — the search box absent, its one sentence in
       * place of it — which is what every local and self-hosted instance sees,
       * and what the seeded shop's stored address and Remove control sit under.
       */
      test(`the shop address card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Shop address" }).waitFor();
        await openSettingsRow(page, "Shop address");
        await page.getByRole("button", { name: "Remove address" }).waitFor();
        await capture(page, "settings-address", scheme);
      });

      /**
       * The dock-day rhythm, open — six minute boxes and the live strip of
       * beats they produce (ADR 20260812-configurable-dock-day-rhythm). Its own
       * capture for the same reason the address card has one: the row is closed
       * in `settings-payments`, and this is the only place the form that
       * replaced a single arrival-call box is looked at. The preview strip
       * underneath is the part worth a baseline — it is the same arithmetic the
       * diver's booking page renders, so a change to the model that quietly
       * stops matching shows up as pixels here.
       */
      test(`the dock-day rhythm card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Dock-day rhythm" }).waitFor();
        await openSettingsRow(page, "Dock-day rhythm");
        await page.getByLabel("Surface interval between dives").waitFor();
        await capture(page, "settings-dock-day-rhythm", scheme);
      });

      /**
       * The emergency reference, open — the five number slots, the vessel and
       * shore-contact boxes, and the free-text plan (issue #688). Its own
       * capture for the same reason as the two rows above: it is closed in
       * `settings-payments`, so the only form in the app whose output a crew
       * reads offshore is otherwise never looked at.
       *
       * The seeded shop fills it in, so this is the state a configured shop
       * sees. The *empty* state — the prompt a crew meets when nobody filled
       * this in — is `manifest-emergency-empty` at the bottom of this file,
       * which needs a shop of its own to produce. This comment used to claim
       * the empty state was "covered where it matters more, on the offline
       * manifest itself"; there was no such capture, and `seed.ts` fills the
       * field precisely so no offline capture could ever show it.
       */
      test(`the emergency reference card renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Emergency reference" }).waitFor();
        await openSettingsRow(page, "Emergency reference");
        await page.getByRole("button", { name: "Save emergency reference" }).waitFor();
        await capture(page, "settings-emergency", scheme);
      });

      /**
       * When the shop's automated messages may reach a diver. Its own capture
       * for the same reason as the two rows above — closed in
       * `settings-payments` — and because it is the only screen standing
       * between a shop in Fiji and a 3 AM text (issue #697).
       */
      test(`the message-hours card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "When we message divers" }).waitFor();
        await openSettingsRow(page, "When we message divers");
        await page.getByRole("button", { name: "Save message hours" }).waitFor();
        await capture(page, "settings-send-window", scheme);
      });

      /**
       * The shop's prepaid dive packages — the price list, and the form that
       * adds one (issue #706). Its own capture for the same reason as the rows
       * above: it is closed in `settings-payments`, and this is the only place
       * a shop states what "ten dives" costs.
       *
       * The seeded shop sells none, so this photographs the empty state plus
       * the add form — which is exactly what a shop meets before the feature
       * turns itself on.
       */
      test(`the dive-packages card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Dive packages" }).waitFor();
        await openSettingsRow(page, "Dive packages");
        await page.getByRole("button", { name: "Add package" }).waitFor();
        await capture(page, "settings-dive-packages", scheme);
      });

      /**
       * The Stripe Tax opt-in (issue #959, ADR
       * 20260826-stripe-tax-is-opt-in-and-provider-owned). Its own capture for
       * the same reason as the rows above — it is closed in
       * `settings-payments`, and this is the only place a shop decides whether
       * DiveDay adds tax to what it charges at all.
       *
       * Captured **off**, which is both the default and what every shop meets
       * first: the decision this row is asking for is legible only if the
       * paragraph explaining what turning it on does is in the picture. Opening
       * a disclosure writes nothing, so this capture leaves the shared fixture's
       * `shops.tax_enabled` exactly as it found it — the flag is shop-wide
       * configuration a reset does not restore, and a spec that drove it would
       * hand a taxed shop to whatever ran next in the worker (ADR
       * 20260815-per-test-private-shops). `e2e/tax.spec.ts` drives it, on a
       * shop of its own.
       */
      test(`the tax card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Sales tax & VAT" }).waitFor();
        await openSettingsRow(page, "Sales tax & VAT");
        await page.getByRole("button", { name: "Save tax setting" }).waitFor();
        await capture(page, "settings-tax", scheme);
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

      // Provider connections are disabled in the browser fleet because their
      // OAuth client secrets are not configured. The useful visual contract is
      // the three-card coming-soon state, which should stay understandable as
      // more providers join the registry.
      test(`integrations settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/integrations");
        await page.getByRole("heading", { level: 1, name: "Shop integrations" }).waitFor();
        await capture(page, "settings-integrations", scheme);
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
        // A row of the day ledger itself, not just the heading — the ledger
        // streams in and a capture taken on the header alone banks an empty
        // page. (The table became day groups with slice 6f, ADR
        // 20260827-clearwater-surface-language.)
        await page.locator('ul[aria-labelledby^="orders-day-"] > li').first().waitFor();
        await capture(page, "orders", scheme);
      });

      /**
       * The same page on the shop's worst day: a Stripe call nobody confirmed,
       * and divers still owed money for a departure the shop cancelled.
       *
       * Both panels render *only* when something has gone wrong, which is
       * exactly why they had never been photographed — and they are the shape
       * most likely to break, being warning-toned blocks of dense prose with
       * inline links. /api/test/seed-trouble-states puts the demo shop into
       * that state; it is a test-only route rather than seed data because a
       * demo permanently shouting that payments are broken is a worse demo
       * (src/db/seed-front-desk.ts says so at the row it seeds `succeeded`).
       * Safe to mutate: each worker owns its own database and resets it before
       * every test (e2e/servers.ts).
       */
      test(`the orders list renders its unfinished money (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("region", { name: "Payments that need a check" }).waitFor();
        await page.getByRole("region", { name: "Refunds you still owe" }).waitFor();
        await capture(page, "orders-unconfirmed-and-owed", scheme);
      });

      /**
       * The one order that has given money back and is still holding some.
       *
       * `partly_refunded` arrived with the staff partial refund (issue #699)
       * and had no capture at all: the seeded example sorts onto a later page
       * of the index, so the only pixel that moved on the whole visual suite
       * was the pager counting one more order. A new money status, a new badge
       * tone, and the refund control's amount field — the actual new UI —
       * photographed nowhere, which is the silent pass the two comments above
       * were written about.
       *
       * Reached through the index's own `?status=` filter rather than a
       * hardcoded id, because the seeded order's uuid is regenerated on every
       * seed. This narrows *which order* is on screen, never the page itself —
       * the surface is captured whole, and the list it lands on is bounded by
       * the same pager the unfiltered one wears (AGENTS.md's rule is against
       * shrinking a capture to dodge an unbounded page, which this is not).
       */
      test(`a part-refunded order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders?status=partly_refunded");
        await page
          .locator('ul[aria-labelledby^="orders-day-"] > li a[href*="/orders/"]')
          .filter({ visible: true })
          .first()
          .click();
        // "Back to diver" for the reason the sibling capture below gives: the
        // eyebrow text is identical on the list this came from, so waiting on
        // it resolves instantly against the old page.
        await page.getByRole("link", { name: "Back to diver" }).waitFor();
        // The refund control is the point of the capture, so the capture waits
        // for it rather than for the heading that arrives before it.
        await page.getByRole("button", { name: "Refund payment" }).waitFor();
        await capture(page, "order-detail-partly-refunded", scheme);
      });

      // One order in full: the total, and the per-line-item amounts that a
      // literal `$` and a hardcoded `/ 100` used to compose by hand.
      test(`an order's detail renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
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

      // The gear-history CSV importer, moved here from the gear register
      // (previously untested visually since it never had a route of its own).
      test(`the gear-history import page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/gear-import");
        await page.getByRole("link", { name: "Download gear CSV template" }).waitFor();
        await capture(page, "settings-gear-import", scheme);
      });

      /**
       * Settings' "Data & integrations" group when the shop owes work it has
       * not finished: photos removed from the app but still in storage, and an
       * erased diver's records still sitting at Stripe. Danger-toned, and the
       * only place either obligation is ever stated — an unfinished erasure is
       * a legal duty, not a notification. Empty on nearly every real day, and
       * therefore never photographed until this capture.
       */
      test(`settings shows the deletions that didn't finish (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("region", { name: "Photos that didn't finish deleting" }).waitFor();
        await page.getByRole("region", { name: "Erasures not finished at Stripe" }).waitFor();
        await capture(page, "settings-data-unfinished", scheme);
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

      // The team surface at rest: inviting staff, and a roster whose rows read
      // their roles as words behind a disclosure — the page-level "Save
      // changes" is gone (ADR 20260827-the-shops-shelves, slice 9h).
      test(`the team settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        await capture(page, "settings-team", scheme);
      });

      // One row's roles open, which is the state that has no still image
      // anywhere else: the checkbox grid inset in the row it belongs to, with
      // no Save button beneath it because closing the row is the save.
      test(`the team roles disclosure renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        const roles = page.getByRole("button", { name: /^Edit roles for / }).first();
        await roles.click();
        await expect(roles).toHaveAttribute("aria-expanded", "true");
        await capture(page, "team-role-disclosure", scheme);
      });

      // The shop's own pre-departure checklist: seeded lines
      // (src/db/seed-pre-departure-checklist.ts), the reorder/delete controls
      // beside each, and the add form (ADR 20260824-pre-departure-safety-check).
      test(`the pre-departure checklist settings render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/safety-checklist");
        await page.getByRole("heading", { level: 1, name: "Pre-departure checklist" }).waitFor();
        await page.getByText("VHF radio checked").waitFor();
        await capture(page, "settings-safety-checklist", scheme);
      });

      /**
       * **The first DiveDay screen a new hire ever sees**, and nothing had ever
       * looked at it. It has an `error.tsx` of its own — somebody thought about
       * its failure path — while its happy path went uncaptured because
       * `check:route-coverage` counted `staff-invite.spec.ts` as coverage and
       * passed (issue #727).
       *
       * Driven through the real invite, because the token is hashed at rest and
       * `/api/test/seed-account-token` will only re-mint for an account that
       * already exists — `inviteStaffMember` is what creates it (ADR
       * 20260726-staff-invite-accounts). Deterministic email, not `Date.now()`:
       * a wall-clock value here is a permanent diff between CI runs, not a
       * regression (same reasoning as the onboarding capture).
       */
      test(`the staff invite page renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const email = `invite-capture-${scheme}@example.com`;
        await page.goto("/shop/blue-mantis/settings/team");
        const inviteSection = page.locator("section").filter({ hasText: "Invite someone" });
        await inviteSection.getByLabel("Full name").fill("Priya Nair");
        await inviteSection.getByLabel("Email").fill(email);
        await inviteSection.getByLabel("Instructor").check();
        await inviteSection.getByRole("button", { name: "Send invite" }).click();
        await expect(page.getByText("Invite sent.")).toBeVisible();

        const seeded = await request.post("/api/test/seed-account-token", {
          data: { email, purpose: "invite" },
        });
        expect(seeded.ok()).toBe(true);
        const { token } = (await seeded.json()) as { token: string };

        await page.goto(`/invite/${token}`);
        // Streams behind a loading.tsx — wait for the page's own h1, the same
        // signal every other account-lifecycle capture here gates on.
        await page.locator("h1").first().waitFor();
        await page.getByLabel("Password", { exact: true }).waitFor();
        await capture(page, "staff-invite", scheme);
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

      // The courses catalog as one ledger (slice 9g of ADR
      // 20260827-the-shops-shelves): agency as the group heading that replaced
      // the tab strip, the list in progression order rather than alphabetical,
      // and the dissolved row — the row's own tap opens the course's editor,
      // with only the two worded list-level acts (Schedule, Hide/Show) beside
      // it and the public-catalog door up in the header.
      test(`the staff course catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await page.getByRole("heading", { level: 2, name: "PADI" }).waitFor();
        await capture(page, "courses-list", scheme);
      });

      // A later page of the same ledger: the group heading re-rendering on the
      // page its rows landed on, which is what "grouping composes with the
      // Pager" looks like. It replaced the `?agency=` tab capture, which
      // photographed a filter that no longer exists.
      test(`a later page of the staff course catalog renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/courses?page=2");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await page.getByRole("heading", { level: 2 }).first().waitFor();
        await capture(page, "courses-list-page-two", scheme);
      });

      // A course's edit page, on the long-form editor pattern (ADR
      // 20260827-the-shops-shelves): the section rail down the first column at
      // 1280 and the same list as a jump-row at 390, eight unboxed sections
      // separated by hairlines rather than eight bordered fieldsets, the depth
      // marker hint beside the prose it governs, and the single Save at the
      // foot — no Hide/Show or Preview beside it (ADR
      // 20260805-remove-certification-paths shipped alongside that trim).
      test(`the course editor renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        // The rail is the frame of this composition, and it is client-rendered;
        // waiting on the server-rendered legend alone let the capture land
        // mid-mount. ("Day by day" now names two elements — the rail's anchor
        // and the section's own legend — so it is no longer a locator.)
        await page.getByRole("navigation", { name: "Sections" }).waitFor();
        await page.getByLabel("Day 1 — what happens").waitFor();
        await capture(page, "course-edit", scheme);
      });

      /**
       * The save bar, which `capture()` above cannot photograph: it is sticky,
       * and a full-page screenshot taken at scroll 0 does not paint a stuck
       * element at all (see `captureStickyFoot`). This form is four thousand
       * pixels of fields with one primary action, so a baseline that omits it
       * is a baseline of the wrong page.
       *
       * It is also the one shot that catches the rail *pinned*: scrolled to the
       * foot, the rail is stuck under the chrome bar with its last entry
       * current, which is the state a full-page capture at scroll 0 flattens
       * away exactly as it does the bar.
       */
      test(`the course editor's save bar renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        await page.getByLabel("Day 1 — what happens").waitFor();
        await captureStickyFoot(page, "course-edit-save-bar", scheme);
      });

      // Owner reporting: "how's my month" over the seeded back-fill — the five
      // unboxed figures and the departures ledger that answer the buyer's
      // revenue question (slice 9f of ADR 20260827-the-shops-shelves; the
      // baseline moved with it, from six bordered tiles over a five-column
      // table).
      test(`owner reports render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("heading", { level: 1, name: "How's your month" }).waitFor();
        await capture(page, "reports", scheme);
      });

      /**
       * The same page on a month that has fully sailed, which is the reading
       * the current month cannot give: every comparison line resolved against a
       * baseline month, and the waiver meters at their final ratios — the amber
       * *remainders* the ledger exists to put in front of a staffer, against
       * the quiet fills that must never take that tone.
       *
       * Walked to through the arrow rather than a literal `?month=`: the suite
       * freezes one instant, so "the month before the frozen one" is
       * deterministic while a hard-coded key would rot the day the clock moves.
       */
      test(`a fully-sailed month's figures render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("link", { name: "Previous month" }).click();
        // The current month renders a "Trips this month" region too, so waiting
        // on the region alone is satisfied before the click has landed — which
        // is how one baseline of this capture came to show July "so far" over
        // June's final figures. The arrow's destination carries `?month=`; the
        // landing page does not.
        await expect(page).toHaveURL(/[?&]month=/);
        await page.getByRole("region", { name: "Trips this month" }).waitFor();
        await capture(page, "reports-figures", scheme);
      });

      /**
       * The waiver surface as one page (ADR 20260827-people-not-lists,
       * decision 4): the release editor, then the signature log as a
       * day-grouped ledger beneath it. The log is paginated
       * (`listWaiverIntegrityAudit`, `WAIVER_INTEGRITY_PAGE_SIZE`) so the demo
       * shop's 150+ signed records are one bounded page under the shared pager
       * rather than a 17,000px capture — the page is what is bounded, not the
       * photograph.
       *
       * Waits for the pager, not just the heading: the log renders below the
       * editor, and a capture taken before it lands photographs half a page.
       */
      test(`the waiver surface renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/waivers");
        await page.getByRole("heading", { level: 1, name: "The release" }).waitFor();
        await page.getByRole("navigation", { name: "Pages" }).waitFor();
        await capture(page, "staff-waivers", scheme);
      });

      /**
       * Materiality as a recorded choice, with the material option selected
       * and Publish armed. Publishing a material version makes every signature
       * the shop holds stop counting at once, so what that costs is on the
       * option being selected rather than in a notice afterwards (issue #720).
       * Photographed because the numbers in it come off the seeded roster — a
       * change that quietly stops counting shows up here as pixels — and
       * because the armed button is the one danger-toned control on the page.
       *
       * The arm carries no `autoResetMs`, and that is what makes this capture
       * deterministic rather than a race: `capture()` resizes, repaints and
       * shoots twice on budgets measured in tens of seconds, while a
       * `setTimeout` runs on the runner's real clock — the fleet freezes
       * `Date`, not timers — so a timed arm let the desktop shot photograph a
       * settled button. See `PublishRelease.tsx`; never reintroduce one here
       * without re-arming inside the capture loop.
       */
      test(`the waiver's materiality choice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/waivers");
        await page.getByRole("heading", { level: 1, name: "The release" }).waitFor();
        await page.getByRole("radio", { name: /A material change/ }).check();
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await page.getByRole("button", { name: /Publish — \d+ sign again/ }).waitFor();
        await capture(page, "waiver-materiality-choice", scheme);
      });

      /**
       * A signed record reached the way a reviewer reaches one: the roster's
       * "View signed record" deep link, which pins the row first inside its own
       * day group and opens it. This is the only state that renders the
       * evidence block — the release version, the two doors, and any flagged
       * medical prompt — so without it nothing has ever looked at it.
       */
      test(`a pinned signed record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/waivers");
        const rows = page.locator('details[id^="waiver-record-"]');
        await rows.first().waitFor();
        const record = (await rows.first().getAttribute("id"))?.replace("waiver-record-", "");
        await page.goto(`/shop/blue-mantis/waivers?record=${record}`);
        await page.locator('details[id^="waiver-record-"][open]').first().waitFor();
        await capture(page, "staff-waivers-record", scheme);
      });

      // The moderation queue as a worklist: one aggregate line under the title,
      // "Waiting on you" leading with its clear-the-lot act, then the published
      // record quiet beneath it (ADR 20260827-people-not-lists, decision 3).
      // Waiting on the worklist group specifically, not just the heading: the
      // groups render above the published run, and a capture taken before they
      // land photographs a half-built page. The seed leaves exactly one review
      // waiting (`seed-history.ts` — Today's deep link depends on that count),
      // so the group's clear-the-lot act is deliberately absent here; the
      // reviews spec exercises it with a second review in hand.
      test(`the review moderation queue renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "What divers said" }).waitFor();
        await page.getByRole("region", { name: /^Waiting on you/ }).waitFor();
        await page.getByRole("region", { name: /^Published/ }).waitFor();
        await capture(page, "staff-reviews", scheme);
      });

      test(`the public reviews archive renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "All reviews" }).waitFor();
        await capture(page, "public-reviews", scheme);
      });

      /**
       * The same queue for a shop that has hidden its way past the line where
       * DiveDay stops publishing its rating to search engines — the warning
       * that explains the Hidden group beneath it, and the only screen that
       * tells a shop its average has stopped being vouched for
       * (ADR 20260813-review-moderation-has-a-floor). Unreachable from the
       * seed: blue-mantis publishes everything, so the fixture route hides
       * however many it takes to cross the threshold.
       */
      test(`the reviews page says when a rating is being withheld (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "What divers said" }).waitFor();
        await page.getByText(/DiveDay has stopped publishing it/).waitFor();
        await capture(page, "staff-reviews-rating-withheld", scheme);
      });

      // Divers asking for a day the board has nothing on, grouped by that day:
      // the seeded requests put two people on one date (one of them by their
      // alternate, one of them flexible into it), which is the whole reason the
      // group header carries a count and the soft matches say which day they
      // did ask for (ADR 20260827-people-not-lists, decision 5). Waiting on the
      // day's own act rather than only the heading — the groups render below
      // it, so a capture taken before one lands photographs a half-built list.
      test(`the date requests list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/requests");
        await page.getByRole("heading", { level: 1, name: "Requested dates" }).waitFor();
        await page.getByRole("link", { name: "Add a departure" }).first().waitFor();
        await capture(page, "staff-date-requests", scheme);
      });

      // Shop-wide discount codes: the create form, then the codes as one
      // ledger shelved live / scheduled / ended, with the trip deals as their
      // own ledger beneath (slice 9g of ADR 20260827-the-shops-shelves; codes
      // themselves are ADR 20260729-shop-promo-codes). The seed holds a live
      // code and an expired one, so two shelves render and the windows and
      // redemption counts sit on the rows.
      test(`the discount codes page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/promos");
        await page.getByRole("heading", { level: 1, name: "Discounts a diver can type" }).waitFor();
        // The shelves are what changed; wait for one rather than for the
        // create card, which paints with the static shell.
        await page.getByRole("heading", { level: 2, name: "Live" }).waitFor();
        await capture(page, "staff-promos", scheme);
      });

      // H-13: a Night-trip seat booked through a shared inbox under a name that
      // doesn't match the person on file shows the fail-closed "Confirm
      // identity" affordance and blocker until staff vouch for it — a
      // safety-critical state worth a baseline.
      test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Trip");
        await page.getByText("Identity unconfirmed").first().waitFor();
        await capture(page, "trip-guests-identity", scheme);
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
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // Scoped to the diver list: the crew section above it carries controls
        // with the same words, for a crew member rather than a diver.
        // Two deliberate steps, the way a crew records it (ADR
        // 20260827-the-departure-is-two-working-surfaces, decision 3): the
        // claim lives in the person's own panel, never on the row.
        const missingRow = page.locator("#roll-call-list > ul > li").first();
        await openManifestPerson(missingRow);
        const markNotBack = page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard" });
        await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await markNotBack.click();
        await expect(
          page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
        ).toBeVisible();
        // Closed again for the shot: the alarm this capture is about is what
        // the *list* shows — the pinned danger line and the one red row — and a
        // panel left open would photograph a person's contact card instead.
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close person details" })
          .click();
        await page.mouse.move(0, 0);
        await capture(page, "manifest-not-back-aboard", scheme);
      });

      /**
      /**
       * **What one diver arranged, on the surface a crew reads it from.**
       *
       * The accessible-dive support-needs record (ADR
       * 20260827-support-needs-are-a-record-about-the-dive). The `prep` capture
       * above carries its panel; this is the manifest half, and it needs a
       * baseline of its own because the marker is inside the person panel —
       * `manifest` photographs the roster at rest and proves nothing about what
       * the tap reveals, and `manifest-person-panel` opens whichever row is
       * first rather than the one with a record on it.
       *
       * The tone is what this baseline is actually for. It has to sit in the
       * same muted voice as the rental fit and the pickup beside it: a fact to
       * plan around, never a warning. A diver who arranged a lift is a diver
       * this shop is ready for, and a surface that renders that as an alert is
       * telling the crew the opposite of what the record exists to say.
       *
       * Diego Alvarez by name, because he is the seeded diver who arranged
       * something (`src/db/seed-support-needs.ts`) and his position on the
       * roster is not this test's to depend on.
       */
      test(`a diver's dive-support record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        const row = page.locator("#roll-call-list > ul > li").filter({ hasText: "Diego Alvarez" });
        await openManifestPerson(row);
        await expect(page.getByRole("dialog").getByText("Dive support")).toBeVisible();
        // The click leaves the pointer on the summary, which would bank a
        // hover-underlined name into the baseline.
        await page.mouse.move(0, 0);
        await capture(page, "manifest-dive-support", scheme);
      });

      /**
       * **One person's panel, open** — the "one tap away" tier of ADR
       * 20260827-the-departure-is-two-working-surfaces, decision 2. The
       * `manifest` capture above photographs ten rows at rest, which proves
       * nothing about what the tap reveals, and everything the row now tucks
       * away is in here: the emergency contact as reference text, the rental
       * line, the buddy team, the note field, and — the reason the panel
       * exists at all — the deliberate second step that records "not back
       * aboard" (decision 3).
       *
       * It replaced a capture of two side-by-side disclosures ("Contact &
       * gear" / "Add a note") that the row no longer has.
       */
      test(`a diver row's person panel renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        const row = page.locator("#roll-call-list > ul > li").first();
        await openManifestPerson(row);
        // Painted before the shot: the facts grid renders its emergency-contact
        // heading and the note field its input. Scoped to the disclosure — the
        // print-only copy of the same facts is in the DOM on every row,
        // carrying the identical heading.
        await expect(page.getByRole("dialog").getByText("Emergency contact")).toBeVisible();
        await expect(page.getByRole("dialog").getByRole("textbox", { name: "Note" })).toBeVisible();
        // The pointer is left on the summary by the click above, which would
        // bank a hover-underlined name into the baseline.
        await page.mouse.move(0, 0);
        await capture(page, "manifest-person-panel", scheme);
      });

      /**
       * A split buddy team after a dive (ADR 20260804-buddy-teams): Tom is
       * recorded back aboard and a human has recorded his seeded teammate Lena
       * **not back**, so his row carries the danger capsule and the count panel
       * adds the "1 buddy team is split" line. Both halves are needed now —
       * Tom aboard while Lena is merely uncalled is the ordinary mid-count
       * state and is deliberately calm (ADR
       * 20260827-the-departure-is-two-working-surfaces, decision 4). The seed
       * carries the teams but no roll-call events (they would open head-count
       * gaps on Today), so the divergent state is driven here and the per-test
       * DB reset puts it back — the same pattern as the missing-diver capture
       * above.
       */
      test(`the manifest's split buddy team renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, a checkpoint switch, and a roll-call
        // write before the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // `manifestRow` anchors on the row's own summary — the name column the
        // person's panel opens from. A bare `hasText` also matches whichever
        // *other* row carries the name in a printed buddy label, which is what
        // the old `<h3>` anchor was guarding against before the name became the
        // row's own summary.
        const tomRow = manifestRow(page, "Tom Okafor");
        const lenaRow = manifestRow(page, "Lena Fischer");
        const boardTom = tomRow.getByRole("button", { name: "Mark boarded" });
        await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await boardTom.click();
        await openManifestPerson(lenaRow);
        const lenaNotBack = page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard" });
        await lenaNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await lenaNotBack.click();
        await expect(
          page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
        ).toBeVisible();
        // Closed again: this capture is about what the list says, not what a
        // panel holds — that is `manifest-person-panel`'s job.
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close person details" })
          .click();
        await expect(tomRow.getByText("Someone unaccounted for")).toBeVisible();
        await page.mouse.move(0, 0);
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
      // ceilings), so the depth is raised for the capture.
      //
      // **No revert, and none needed.** A dive site is schedule data, not shop
      // configuration: `resetDemoSchedule` deletes `dive_sites` and re-seeds it
      // before every test, so the next one reads Molasses Reef back at the
      // seeded 12m whatever this test did or how it died. The `finally` that
      // used to set it back was restoring a value the harness restores anyway,
      // and it was not free — it put a second full form round-trip inside the
      // same ceiling the capture had already spent, which is precisely how the
      // nitrox capture at the foot of this file used to fail: the renderer
      // wedged, the paint waits and the screenshot burned the budget, and the
      // timeout landed on the revert. A revert that cannot run when it matters
      // and is not needed when it can is only a way to run out of clock.
      test(`the roster's depth warning renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // One briefing save, then board → trip → Guests before the shot.
        // Measured failing at HEAD *and* on `main` at one worker, so it was
        // never a contention problem: the budget was simply never sized for
        // what the test does. A flat 60s when it was written, which stopped
        // tracking the budgets the moment they were derived — and by now
        // *lowered* this test below the plain-capture ceiling it was raised
        // above. Same allowance as every other flow capture here.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("link", { name: "Molasses Reef" }).first().click();
        await page.waitForURL(/\/dive-sites\//);
        await page.getByLabel(/Maximum depth/).fill("32");
        await page.getByRole("button", { name: "Save dive site" }).click();
        await page.getByText("Dive site saved.").waitFor();

        await openReefTrip(page);
        await openTripTab(page, "Trip");
        await page
          .getByText(/deeper than the/)
          .first()
          .waitFor();
        await capture(page, "trip-guests-depth-warning", scheme);
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
        await openTripTab(page, "Trip");
        const row = page.locator("#roster li").filter({ visible: true }).first();
        const noteBody = "Visual regression seed note for the undo toast.";
        await openRosterNotes(row);
        await row.getByLabel("Add a note only staff can see").fill(noteBody);
        await row.getByRole("button", { name: "Add private note" }).click();
        // Adding a note no longer navigates, so there is no longer a toast
        // saying it worked — the note appearing in the list above the box *is*
        // the confirmation, which is the point of the change. Wait for that.
        await row.getByText(noteBody).waitFor();

        // And because nothing navigated, the disclosure is still open — hence
        // the helper, which would otherwise close it and hide the Delete
        // button it is about to press.
        await openRosterNotes(row);
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
        await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Diego+Alvarez`);
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
        await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Odile+Marchand`);
        await page.getByRole("button", { name: "Add Odile Marchand to the trip" }).click();
        await page.getByText("This charter requires a Deep certification.").waitFor();
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
        await openTripAbout(page);
        await page
          .locator("section")
          .filter({ has: page.getByRole("heading", { name: "Readiness requirements" }) })
          .getByText(/never blocks? enrolment/)
          .first()
          .waitFor();
        await capture(page, "trip-manage-course-requirements", scheme);
      });

      // The shop's own dive-site library, which had no baseline at all until
      // it gained a search band and a pager. One grouped ledger since ADR
      // 20260827-the-shops-shelves — difficulty groups easiest first, the
      // requirement words on the rows that carry one, and the DiveDay catalog
      // as the quiet door at its tail.
      test(`the dive-site library renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
        // A seeded row, not just the heading: this route is `instant = true`,
        // so the heading is already in the static shell while `loading.tsx`'s
        // skeleton is what stands where the ledger will be.
        await page.getByRole("link", { name: "Molasses Reef", exact: true }).waitFor();
        // The tail door, which is the last thing the page paints — it carries a
        // count read from the published catalog rather than from this page.
        await page.getByRole("link", { name: "Browse the DiveDay catalog" }).waitFor();
        await capture(page, "dive-sites-library", scheme);
      });

      // The gear register on a calm morning (ADR 20260827-the-shops-shelves,
      // slice 9d): the kind chips, one "On the wall" group of hairline rows
      // carrying their reserved-for and service sentences, the register's own
      // coral line — nothing is out — and the add-a-unit form. The three stat
      // tiles and the Returns panel that used to sit above this are gone; the
      // groups are the states now.
      test(`the gear register renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last seeded tank's row — the ledger below the fold has settled.
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await capture(page, "gear-register", scheme);
      });

      // One unit's record — chosen for the tank whose seeded visual
      // inspection lands inside the due-soon window, so the clock grammar
      // (amber state line + per-clock list) is in frame alongside the
      // service log form and history.
      test(`a gear unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "AL80-03" }).click();
        await page.getByRole("heading", { level: 1, name: "AL80-03" }).waitFor();
        await capture(page, "gear-unit", scheme);
      });

      // The way back to a deleted unit (ADR 20260820-every-delete-is-soft):
      // the Deleted chip in the filter band, and the list whose one act is
      // Restore. Photographed after deleting a unit rather than seeding one —
      // the shop's demo fleet is what a shop should see, and a permanently
      // deleted regulator in it would be a worse demo.
      test(`the gear register's deleted units render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted." }).waitFor();

        await page.goto("/shop/blue-mantis/gear?view=deleted");
        await page.getByRole("button", { name: "Restore Reg #5" }).waitFor();
        await capture(page, "gear-register-deleted", scheme);
      });

      // The same unit's own record while it is deleted (issue #614): the
      // Deleted badge in the header, the service clocks and the unfolded
      // paper trail that are the reason the row survived the delete, and a
      // page carrying no control but Restore. The read-only shape is what
      // this watches — a write form creeping back in is invisible in a diff
      // of the page, which branches in five places.
      test(`a deleted unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        const record = page.url();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted." }).waitFor();

        await page.goto(record);
        await page.getByRole("button", { name: "Restore unit" }).waitFor();
        await capture(page, "gear-unit-deleted", scheme);
      });

      // The register on a working morning, through /api/test/seed-trouble-states
      // (never seeded into blue-mantis, whose whole fleet is calm): all three
      // of the register's groups in one frame — a unit out with a diver and due
      // back today at a named time, a checked-out unit gone overdue carrying
      // the warning word and its drawn mark, and the wall beneath them with a
      // lapsed tank inspection in its service sentence. `?gearOut=1` is opt-in
      // because a unit due back today is also a row on Today (ADR
      // 20260827-the-shops-shelves, slice 9d).
      test(`the gear register's out and overdue groups render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?gearOut=1");
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // Both group headings, so the capture can never land on a half-built
        // ledger — and the wall's own rows are what the `AL63-02` wait below
        // proves have arrived.
        await page.getByRole("heading", { level: 2, name: /^Out/ }).waitFor();
        await page.getByRole("heading", { level: 2, name: /^Overdue/ }).waitFor();
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await capture(page, "gear-register-trouble", scheme);
      });

      // The register's fleet-wide service reading (ADR 20260827-the-shops-shelves,
      // slice 9d as amended after review): the one question the three groups
      // do not answer, reached from the band's own chip. Two shapes in one
      // frame off the calm demo fleet — Reg #4 pulled off the wall and leading
      // because it is stopped now, and AL80-03's visual inspection three weeks
      // out, which is the month-ahead heads-up Today's six-day queue never
      // mentions. No trouble seed: this is a shop having an ordinary week.
      test(`the register's service-due view renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear?view=service");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last row of the list, so the capture cannot land half-built.
        await page.getByRole("link", { name: "AL80-03" }).waitFor();
        await capture(page, "gear-register-service-due", scheme);
      });

      // A site's own briefing form, which is where the route a shop draws is
      // drawn. Captured on a seeded site that already has one, so the frame
      // holds the map, the curve, and its start/finish dots rather than the
      // empty state — the thing worth having a baseline of. The terrain
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

      /**
       * The same long form with nothing in it — a landmark editor, a creature
       * picker, and every field a shop meets before it has anything to edit.
       * Its sibling above was captured and this one never was (issue #727),
       * and an empty form is a different picture: every placeholder, every
       * "(optional)", and the empty states of both list editors.
       */
      test(`the new-dive-site form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites/new");
        await page.getByLabel("What the route is called").waitFor();
        await capture(page, "dive-site-new", scheme);
      });

      /**
       * The same editor mid-edit — the one state neither capture above can
       * hold. ADR 20260827-the-shops-shelves' long-form editor pattern put a
       * section rail beside the form and a sentence beside the one Save; the
       * rail's current entry and that sentence are both *derived*, so a resting
       * capture photographs neither. This types into two sections, which is
       * what turns the sentence from a name into a count.
       */
      test(`the briefing editor mid-edit renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/dive-sites/new");
        await page.getByLabel("What the route is called").waitFor();
        await page.getByLabel("Name").fill("Turtle Ledge");
        await page.getByLabel("Depth range").fill("20-45 ft");
        await page.getByText("Unsaved changes in 2 sections").waitFor();
        await capture(page, "dive-site-editor-unsaved", scheme);
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

      // DiveDay's published dive-site templates, in the same ledger grammar as
      // the library they feed (ADR 20260827-the-shops-shelves): the row is the
      // preview door, Import is its one act. It is the
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
       * The staff command palette and the app's not-found backstop — surfaces
       * that are *states*, not routes, and so had no baseline at all.
       *
       * The palette is hosted on `/settings/calendar` rather than Today. It is
       * `position: fixed`, and a `fullPage` shot renders a fixed element once,
       * at the top, above however much page happens to sit underneath — so
       * hosting it on the tall dashboard would bank a baseline that re-diffs
       * every time Today's queue changes, for a change that has nothing to do
       * with the overlay. The calendar settings page is the shortest read-only
       * staff surface there is (two panels, no seeded rows, nothing minted
       * until a button is pressed), so almost all of the image is the overlay
       * itself.
       *
       * It closes its overlay before finishing: an overlay left open leaks
       * into whatever the same page does next.
       */
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
        await waitForEntranceAnimations(page);
        await capture(page, "command-palette", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      // The same panel with results in it, which is the half no baseline had:
      // searched groups draw their own glyph in the same rail as the "Go to"
      // rows (issue #773), and only a query shows them. Waits for a real
      // option rather than for the request — the input is debounced, so the
      // rendered row is the only honest signal that the answer landed.
      test(`the command palette with results renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await box.fill("reef");
        await expect(page.getByRole("option", { name: /Reef/ }).first()).toBeVisible();
        await waitForEntranceAnimations(page);
        await capture(page, "command-palette-results", scheme);
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

  /**
   * **The guard for issues #1245 and #1276** — the 608px flap at 390 and the
   * mid-fade colour step at 1280, which the measurements on both tickets
   * resolved to one `::details-content` transition.
   *
   * Two things are asserted, because two different mistakes each reintroduce
   * the bug and only one of them is visible in a diff:
   *
   * 1. **`getAnimations()` cannot see this transition.** That is why
   *    `screenshotOrGiveUp`'s `animations: "disabled"` — which drives exactly
   *    that list — was in place throughout and never helped. Pinned here so a
   *    future reader deleting `withTransitionsOff` in favour of "Playwright
   *    already disables animations" is told why that is false before they find
   *    out from a flaky baseline.
   * 2. **The switch-off actually reaches the pseudo-element**, and holds the
   *    document at one height across the resize. `*, *::before, *::after` does
   *    not match `::details-content`, so the explicit selector is load-bearing
   *    and silently droppable.
   *
   * Priya's record rather than a built one: `seed-diver-trail.ts` gives her the
   * file groups whose bodies are what the `40rem` rule lays out, and a seeded
   * diver costs no form-filling. The frame samples need no timeout — 25 frames
   * outlast a 200ms transition on any renderer that is drawing at all, and a
   * renderer that is not drawing produces no samples and fails on the count.
   */
  test.describe("the disclosure transition, which no screenshot may catch running", () => {
    signedInAsOwner();
    test.use({ viewport: { width: 1280, height: 800 } });

    const heightsAcrossResize = (page: Page) =>
      page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const heights: number[] = [];
            const tick = () => {
              heights.push(document.documentElement.scrollHeight);
              if (heights.length < 25) requestAnimationFrame(tick);
              else resolve(heights);
            };
            requestAnimationFrame(tick);
          }),
      );

    test("is invisible to getAnimations(), so only the switch-off settles it", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      // Crossing 40rem downward is what starts it — the same resize `capture()`
      // performs on its first viewport.
      await page.setViewportSize({ width: 390, height: 844 });
      const running = await page.evaluate(() =>
        document.getAnimations().map((animation) => animation.constructor.name),
      );
      expect(
        running.filter((name) => name === "CSSTransition"),
        "if Chromium has started listing ::details-content transitions, Playwright's " +
          'animations: "disabled" may now settle this on its own — re-measure before ' +
          "trusting it, and keep the switch-off until it does",
      ).toEqual([]);
    });

    test("holds the document at one height when the switch-off is installed", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      const settled = await withTransitionsOff(page, async () => {
        // Read the pseudo-element directly: the universal selector does not
        // reach it, so this is the assertion that the explicit entry in
        // CAPTURE_TRANSITIONS_OFF is doing the work.
        const duration = await page.evaluate(() => {
          const disclosure = document.querySelector("details");
          return disclosure
            ? getComputedStyle(disclosure, "::details-content").transitionDuration
            : "no disclosure on the page — this guard needs one";
        });
        expect(duration.split(", ")).not.toContain("0.2s");

        await page.setViewportSize({ width: 390, height: 844 });
        return heightsAcrossResize(page);
      });

      expect(settled).toHaveLength(25);
      // One height for the whole window. Measured without the switch-off on the
      // same record, this reports two heights ~677px apart, held for the first
      // thirteen frames — the flap #1245 measured as 608px before the page grew.
      expect(new Set(settled).size).toBe(1);
    });
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
 * Print / Save-as-PDF surfaces. The complete trip packet, manifest, prep list,
 * and departure log are the documents staff physically print for the dock, and print gets a dedicated
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

  // **Not "every staff tab" any more, and that is the point.** The packet used
  // to compose all four, which is how 42 buttons — "Cancel trip" among them —
  // came to be printed beside a roster (issue #814). It composes the dive plan
  // it renders itself, plus the two tabs that were already documents.
  test("the trip packet prints the dive plan, the manifest and the prep list", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/print`);
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();
    await page.emulateMedia({ media: "print" });
    const packetNavs = page.locator('nav[aria-label="Trip"]');
    await expect(packetNavs).toHaveCount(2);
    for (const nav of await packetNavs.all()) await expect(nav).not.toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await capturePrint(page, "trip-packet");
  });

  // The departure log exists to be printed and handed over, so the print
  // rendering is the primary artifact, not a nice-to-have.
  test("the departure log prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/log`);
    await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
    await capturePrint(page, "departure-log");
  });
});

/**
 * **The emergency card with nothing in it.**
 *
 * The one panel on a safety surface that renders *because* the shop has not
 * answered a question — a red-bordered prompt where five phone numbers should
 * be, read by a crew at the rail. Every other capture in this file sees the
 * seeded shop, which fills the field in deliberately ("an unseeded shop would
 * photograph its own empty state on every capture of that page", `seed.ts`),
 * so this state had never been looked at and the settings capture above
 * claimed, wrongly, that it had been.
 *
 * A private shop, because clearing the reference is shop-wide configuration —
 * the reset restores the schedule, not the settings, so doing this to
 * blue-mantis would hand a blank emergency card to whichever spec ran next in
 * this worker (ADR 20260815-per-test-private-shops).
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — the unanswered emergency reference`, () => {
    // **A pinned identity, or this capture is noise.** The minted shop's name
    // renders in the staff header and its slug-derived owner email in the dev
    // banner, and `generateDemoShopIdentity` draws both at random — so without
    // this the capture reported as changed on the very next pull request,
    // "Verdant Trench Dive Co" against "Verdant Lagoon Dive Center", with
    // nothing about the page itself different. Masking those two lines is the
    // other way out and the repo refuses it: a masked capture cannot catch what
    // it covers.
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "harbour-lantern-dive-co",
    });

    /**
     * **The one first-run question a trading shop can still have open.**
     *
     * A minted shop is the only fixture that can honestly show this: it has a
     * board and has never answered the units question, which is exactly the
     * shape issue #835 is about. The canonical demo finishes its onboarding in
     * the seed, so it has no row — and arranging one on it would not work
     * anyway, because `/api/test/reset` restores the schedule and **not** the
     * `shops` columns, so a nulled `units_confirmed_at` would follow the worker
     * into every later test in the run. A test that writes shop-wide settings
     * takes a shop of its own (AGENTS.md); this one does not have to write
     * anything at all.
     */
    test(`the queue still asks an unanswered setup question (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The home itself, and nothing to open. The question is bound to no
      // departure, so `assembleDaySpine` files it under "At the desk", which
      // the spine renders unfolded — where the old `?view=urgency` queue put it
      // inside a "This week" band a reader had to expand. That queue is gone
      // (ADR 20260827-clearwater-surface-language), `?view=` 308s here, and
      // "This week" is now a plain door to the schedule board whose stretched
      // link would swallow the click this test used to make.
      await page.goto(`/shop/${privateShop.slug}`);
      // The row's own words, not a timing guess.
      await page.getByText(/currency and depth unit/).waitFor();
      await capture(page, "today-units-unconfirmed", scheme);
    });

    test(`the manifest prompts for an emergency reference nobody filled in (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/settings`);
      await openSettingsRow(page, "Emergency reference");
      // Cleared through the shop's own form, which is how a shop would arrive
      // in this state — not by writing the column behind the app's back.
      const filled = page.locator(
        'input[name^="emergencyLabel-"], input[name^="emergencyPhone-"], ' +
          'input[name="emergencyVessel"], input[name="emergencyShoreContact"]',
      );
      // The seeded shop has an emergency reference on file, so these boxes
      // exist — and if they ever stop existing, the capture below would
      // otherwise photograph a *populated* panel under an "empty" name.
      await expect(filled).not.toHaveCount(0);
      for (const field of await filled.all()) await field.fill("");
      await page.locator('textarea[name="emergencyPlan"]').fill("");
      await page.getByRole("button", { name: "Save emergency reference" }).click();
      // The row comes back open with its saved notice — the destination's own
      // render, not a timing guess.
      await page.getByText("Emergency reference saved.").waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Manifest");
      await page
        .getByRole("button", { name: "Emergency numbers & response plan" })
        .filter({ visible: true })
        .click();
      // The prompt itself, not just the heading — the whole point of the
      // capture is the state where there is nothing under it.
      await page.getByText("No emergency numbers recorded").waitFor();
      await capture(page, "manifest-emergency-empty", scheme);
    });
  });
}

/**
 * **A shop that doesn't fill nitrox.**
 *
 * With the catalog off and no live request left on the departure, Total and Air
 * collapse into a single tile — there is nothing for a second number to
 * distinguish. The reef charter is the fixture that can show it: unlike the
 * wreck charter it never had a nitrox request seeded onto it, so turning the
 * catalog off leaves no live data to keep the tile alive (the same premise
 * `e2e/nitrox.spec.ts` asserts on).
 *
 * **A shop of its own, because this writes shop-wide configuration.**
 * `shops.rental_items` is not restored by the per-test reset — it puts back
 * three `shops` columns and no others — so this used to bracket the capture in
 * a `try/finally` that turned blue-mantis's catalog back on. That is the shape
 * AGENTS.md and ADR 20260815-per-test-private-shops refuse, and on 2026-08-23
 * it failed exactly as predicted: the capture hit the known unattributed
 * Chromium wedge, both paint waits and the screenshot burned the test's
 * ceiling, and the timeout landed on the **first line of the `finally`** — so
 * the revert never ran and blue-mantis was left not filling nitrox for every
 * later test in that worker. A `finally` is not isolation: it competes for the
 * same clock as the failure it is there for, and it does not run at all when
 * the worker dies. `e2e/nitrox.spec.ts` moved off this pattern for the same
 * reason; this capture was the one site left on it, and its comment still
 * pointed at that file as the precedent.
 *
 * The wedge itself is unchanged and unfixed by this — a wedged renderer still
 * fails the test, and ci.yml's visual job still reruns the failed captures once
 * on the probe's "wedged, not slow" verdict. What changes is the blast radius:
 * the failure now costs one capture instead of quietly re-premising the rest of
 * the shard.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header and its slug-derived
 * owner email in the dev banner, and `generateDemoShopIdentity` draws both at
 * random — so an unpinned capture reports as changed on the very next pull
 * request with nothing about the page itself different.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — a shop that stops filling nitrox`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "slack-tide-dive-charters",
    });

    test(`the prep page's tank tile collapses with nitrox off (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The mint and the live sign-in the fixture pays for, then one settings
      // round-trip and board → trip → Prep before the capture.
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings`);
      await openSettingsRow(page, "What we rent");
      await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
      await page.getByRole("button", { name: "Save rental catalog" }).click();
      // The row comes back open with its saved notice — the destination's own
      // render, not a timing guess.
      await page.getByText("Rental catalog saved.").waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Prep");
      await page.getByRole("heading", { name: "Tanks" }).waitFor();
      await capture(page, "prep-no-nitrox", scheme);
    });
  });
}
