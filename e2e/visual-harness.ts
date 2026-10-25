import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { requireFreshBuild } from "../scripts/e2e-build-evidence.mjs";
import {
  captureBuildBoundary,
  matchesRoute,
  writeCaptureEvidence,
} from "../scripts/visual-evidence.mjs";
import { visualSpecs } from "../scripts/visual-specs.mjs";
import { REVEAL_MARKER_ATTRIBUTE, REVEAL_READY_ATTRIBUTE } from "../src/components/MarketingReveal";
import { DIVE_SITE_TEMPLATES } from "../src/content/dive-site-templates";
import { DEMO_SHOP_BRAND } from "../src/db/seed-shop-brand";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { OFFLINE_MANIFEST_PENDING_GRACE_MS } from "../src/lib/offline-manifest-store";
import {
  OFFLINE_MANIFEST_AGING_MS,
  OFFLINE_MANIFEST_RECORD_VERSION,
} from "../src/lib/offline-manifests";
import { expect, makeActivitySafe, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab, seededTripId } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";
import { auditInitialPaint, INITIAL_PAINT_FALLBACK } from "./visual-audit-initial-paint";
import { PHONE_VIEWPORT, schemeViewports, VIEWPORTS } from "./visual-viewports";

export { PHONE_VIEWPORT, VIEWPORTS } from "./visual-viewports";

export const staffCopy = staffTranslator("en-US");
export const diverCopy = diverTranslator("en-US");
export const CATALOG_MAP_SITE_COUNT = DIVE_SITE_TEMPLATES.filter(
  ({ briefing }) => briefing.forecastLatitude != null && briefing.forecastLongitude != null,
).length;

export async function expectOverviewMapSites(page: Page, count: number) {
  await expect
    .poll(() =>
      page.locator(".leaflet-container").evaluate((map) => {
        const bounds = map.getBoundingClientRect();
        const targets = [
          ...map.querySelectorAll(".leaflet-site-marker button, button.leaflet-site-cluster"),
        ];
        return {
          sites: targets.reduce(
            (sum, target) =>
              sum + (target.matches(".leaflet-site-cluster") ? Number(target.textContent) : 1),
            0,
          ),
          clipped: targets.flatMap((target) => {
            const rect = target.getBoundingClientRect();
            return rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= bounds.left &&
              rect.top >= bounds.top &&
              rect.right <= bounds.right &&
              rect.bottom <= bounds.bottom
              ? []
              : [target.getAttribute("aria-label")];
          }),
        };
      }),
    )
    .toEqual({ sites: count, clipped: [] });
}

export async function expectPopupInMap(page: Page, popup: Locator) {
  await expect
    .poll(async () => {
      const card = await popup.boundingBox();
      const map = await page.locator(".leaflet-container").boundingBox();
      if (!card || !map) return Number.NEGATIVE_INFINITY;
      return Math.min(
        card.x - map.x,
        card.y - map.y,
        map.x + map.width - card.x - card.width,
        map.y + map.height - card.y - card.height,
      );
    })
    .toBeGreaterThanOrEqual(0);
}

export async function waitForSiteMap(page: Page) {
  // The server heading can precede both lazy imports. Pins or clusters prove
  // the data effect ran; controls and attribution prove Leaflet initialized.
  const map = page.locator(".leaflet-container");
  await map.locator(".leaflet-site-marker button, button.leaflet-site-cluster").first().waitFor();
  await map.locator(".leaflet-control-zoom-in").waitFor();
  await map.locator(".leaflet-control-attribution").waitFor();
}

export async function openStandaloneLibraryMapPin(page: Page) {
  const pin = page.locator(".leaflet-site-marker button").first();
  const savedZoom = () =>
    page.evaluate(() => {
      const key = Object.keys(sessionStorage).find(
        (candidate) => candidate.startsWith("diveday:map:") && candidate.endsWith(":library"),
      );
      return key ? Number(JSON.parse(sessionStorage.getItem(key) ?? "null")?.zoom ?? -1) : -1;
    });
  // A group can contain closer subgroups. Follow the real drill-in flow,
  // requiring every click to finish at a higher zoom before choosing again.
  for (let level = 0; level < 19; level += 1) {
    if ((await pin.count()) > 0) return pin;
    // -1 before the first drill-in: the untouched overview keeps no camera.
    const previousZoom = await savedZoom();
    if (level > 0) expect(previousZoom).toBeGreaterThanOrEqual(0);
    await page.locator(".leaflet-site-cluster").first().click();
    await expect.poll(savedZoom).toBeGreaterThan(previousZoom);
  }
  throw new Error("No individual library site appeared after drilling into its clusters");
}

export async function waitForSiteLibrary(page: Page) {
  await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
  // The ledger and its final catalog-count link can finish before the lazy map.
  await page.getByRole("link", { name: "Molasses Reef", exact: true }).waitFor();
  await page.getByRole("link", { name: "Browse the DiveDay catalog" }).waitFor();
  await waitForSiteMap(page);
}

/**
 * Visual regression coverage: one `capture()` call per surface, each shot in
 * light at a phone and a desktop viewport and in dark at the desktop viewport
 * alone (`DARK_VIEWPORTS`), down from two widths in dark (see ADR
 * 20260729-reg-suit-visual-regression). No count is kept here, because every
 * hand-kept one drifted: `grep -c 'await capture(page,' e2e/visual-*.spec.ts`
 * reads one more than the number of calls, because it also matches this
 * sentence. Each `capture()` call costs 3 screenshots per CI run, 4 for a
 * surface named in `TABLET_SURFACES`, which takes a third viewport in light.
 *
 * Eight more come from the `print` block at the bottom: the manifest, prep,
 * trip-packet, day-packet, departure-log and paper-pass pages, among others,
 * as they render for the printer. Print
 * is its own concern, not a light/dark one — the `@media print` token override
 * collapses both schemes to one black-and-white palette — so each is captured
 * once, at a US-Letter width (or a wider sheet's own), via `capturePrint()`.
 *
 * `captureStickyFoot()` adds 6 more (two surfaces × light at both widths and
 * dark at the desktop), `captureFolded()` 1 (light, phone), and
 * `TABLET_SURFACES` 6 — six surfaces a shop runs on a tablet get a third,
 * portrait width in light. The extra width is a small addition, not the 50% a
 * third viewport applied to every surface would have cost.
 *
 * Four of them are the same surface twice, in a second language: see
 * {@link SPANISH}. A Spanish sibling takes the standard pair and keys its own
 * baseline off `<name>-es-ES`, so it is a new item in the report rather than a
 * change to the English one.
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
 * loses exactly its own PNGs — three, or four for a `TABLET_SURFACES` one —
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
 * `capture()` loops over its scheme's viewports itself, resizing the page for each and
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
 * rasterize every band, then waits on `document.fonts.ready`. The webfonts
 * (next/font/local, `src/app/_fonts/`) load asynchronously; without that wait a capture can land
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

const TABLET_VIEWPORT = { width: 820, height: 1180 } as const;

/**
 * The capture names that get `TABLET_VIEWPORT` as a third width — **six, not
 * every surface in this file.**
 *
 * A third width applied everywhere is another 506 screenshots and the baseline
 * churn to match, and most routes have nothing new to say at 820px. So the
 * list is a constant rather than a global width: the cost is bounded, and
 * which surfaces earn it is a decision a reviewer can argue with in one place
 * instead of inferring from a diff.
 *
 * Why each one:
 *
 * - `trip-desk` — a departure's Divers tab with its arrivals open, the
 *   counter. The front desk is a tablet on a stand and nothing else.
 * - `manifest` — worked at the rail in a dry case.
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
  "trip-desk",
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
 * the visual specs back is the cheapest thing that can tell a typo from a decision.
 * Once per worker process, against files already on the page cache.
 */
const VISUAL_SPEC_TEXT = visualSpecs()
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const name of TABLET_SURFACES) {
  if (!VISUAL_SPEC_TEXT.includes(`capture(page, "${name}"`)) {
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
 *
 * **Second correction, 2026-09-10: `unoptimized` took sharp out and left the
 * browser's own decoder in.** `site-briefing` and `booking-pitch-open` kept
 * reporting changed after all of the above was in place -- five issues' worth
 * (#1585, #1567, #1432, #1405, #1623), always the same one marine-life
 * photograph, never anything else on a 6,000px page, max channel delta 6 to 10.
 * #1597 measured it: twelve runs of one build on one machine, two byte-exact
 * variants, flipping about one run in three, and the only thing that moved the
 * outcome was what else had already run in the browser process.
 *
 * That is a decode-cache signature, not a timing one, and the wait loop above
 * cannot reach it. With `unoptimized` there is no srcset, so the browser is
 * handed the repository's own 640px file and picks its own decode scale; a JPEG
 * decoder can decode at N/8 of the stored size, so a source two or more times
 * the rendered box has more than one legal decode and the cache's state chooses
 * between them. `src/lib/marine-life-tiles.ts` closes it by serving every
 * marine-life tile a committed variant whose width sits strictly inside
 * `(box/2, 2*box)` -- one legal decode, one fixed resample -- and only under
 * `DIVEDAY_E2E`, so production still renders the full-size source through the
 * optimizer. The captures below that render a species therefore photograph a
 * box-sized file rather than a 640px one, which is closer to what a browser is
 * served in production, not further. *
 * **Third correction, 2026-10-23: the shop photo strip stopped being
 * photographed at all.** #2937 found ten captures whose only diff was the
 * storefront's strip, same photos on both sides, a fourth variant of this
 * class. Rather than a fifth mechanism, `tileShopPhotos` (below) answers those
 * photos with one flat tile in every capture (H-157); a non-visual test keeps
 * proving the real ones load.
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
/**
 * The one class that can make a surface photograph as nothing.
 *
 * `.marketing-reveal-pending` holds `opacity: 0` in its *base* style
 * (globals.css) and becomes visible only through the fill of the animation its
 * IntersectionObserver starts, so an element wearing it at shutter time is a
 * blank band in the capture. Named once here because two places read it: the
 * corrective sweep inside `paintWholeDocument` and the tripwire at the end of
 * it (issue #1910).
 *
 * Its sibling `.marketing-hero-motion` deliberately is **not** here. That one's
 * inactive state is the visible one — the CSS hangs `marketing-device-arrive`
 * and `marketing-roll-call-settle` off `.marketing-hero-motion-active`, so a
 * hero whose observer never fires loses an arrival and keeps its content. It
 * fails to *animate*; this one fails to *appear*, which is the whole difference.
 */
const PENDING_REVEAL_SELECTOR = ".marketing-reveal-pending";
// Budget for the whole image pass, not per image. It has to cover a cold
// `/_next/image` generating a width it has never been asked for, on a CI runner
// already running the other shards — the 5s this replaced was under that.
const IMAGE_SETTLE_MS = 15_000;
// The entrance-animation settle (`waitForEntranceAnimations`, at the end of
// `paintWholeDocument`). Every finite animation this app runs is a Reef
// entrance: 600ms is the delight budget's ceiling (ADR
// 20260904-reef-all-the-way-down, Budget rule 2) and the marketing reveal is
// 220ms, so this is five times the longest of them. It is a bound on a wait
// that should already be over, not a duration anything is expected to use.
const ANIMATION_WAIT_MS = 3_000;

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
const ANIMATION_STALL_MS = ANIMATION_WAIT_MS + PROTOCOL_SLACK_MS;
/**
 * The pending-reveal tripwire at the end of `paintWholeDocument`: one
 * `querySelectorAll` count, so protocol slack is its whole budget. It was the
 * one evaluate there left unbounded, and on 2026-10-12 a wedged renderer hung
 * inside it until the test's own ceiling, with no "wedged, not slow" verdict
 * for CI's rerun gate to read.
 */
const TRIPWIRE_STALL_MS = PROTOCOL_SLACK_MS;
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
const PAINT_BUDGET_MS = PAINT_STALL_MS + FONTS_STALL_MS + ANIMATION_STALL_MS + TRIPWIRE_STALL_MS;
/**
 * The bounded waits that each pay one `RENDERER_PROBE_MS` diagnostic on the
 * path that has already given up: `paintWholeDocument`'s scroll-through/image
 * settle, font settle, entrance-animation settle and pending-reveal tripwire, plus
 * `screenshotOrGiveUp`'s probe on a screenshot that never returned.
 *
 * This is *per viewport*, and that is the correction. The ceiling below is
 * documented as the sum of the work it bounds, but the overhead term used to
 * budget two probes total while a fully-wedged capture pays one per wait per
 * viewport — four then, five since the tripwire was bounded. The missing 10s came out of the same term's allowance for
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
const STALL_PROBES_PER_VIEWPORT = 5;
const STALL_PROBE_BUDGET_MS = RENDERER_PROBE_MS * STALL_PROBES_PER_VIEWPORT * VIEWPORTS.length;
/** The viewport resizes and the navigation that preceded them. */
const CAPTURE_OVERHEAD_MS = 10_000;
export const SURFACE_TIMEOUT_MS =
  (PAINT_BUDGET_MS + SCREENSHOT_GIVE_UP_MS) * VIEWPORTS.length +
  STALL_PROBE_BUDGET_MS +
  CAPTURE_OVERHEAD_MS;

// Applied at file scope rather than per describe block, so every test in the
// file gets it whether or not it sits inside one and nothing depends on a
// nested describe inheriting its parent's configuration.

/**
 * **The pixel probe** (`scripts/pixel-probe/`, docs/design/pixel-craft.md): with
 * `PIXEL_PROBE=1`, `capture()` measures every light-scheme surface after each
 * viewport's screenshot — geometry, forced hover and focus at the desktop
 * width, and a sweep of the tight edge of each Tailwind band — and writes
 * candidates to `e2e/pixel-probe/` (gitignored, never under `e2e/screenshots/`,
 * which reg-suit compares). CI never sets it, and with it unset nothing below
 * runs and nothing is even imported.
 *
 * Its budget is derived the way `SURFACE_TIMEOUT_MS` is, from the bounds the
 * probe itself honours: every page evaluate and protocol call goes through
 * `withRendererBound` at one of these ceilings, and the state pass stops
 * starting new elements at its deadline. A capture that probes extends its own
 * test by the sum, so a slow probe degrades to a `skipped` record rather than
 * turning a green capture red.
 */
const PIXEL_PROBE = process.env.PIXEL_PROBE === "1";
/** One `collectGeometry` walk of the document. */
const PROBE_COLLECT_MS = 15_000;
/** Any one protocol step: a forced state, a measure, a resize settle. */
const PROBE_CALL_MS = 5_000;
/** The desktop state pass starts no new element after this. */
const PROBE_STATES_MS = 45_000;
/** The focus-ring pass at the other widths starts no new element after this. */
const PROBE_RINGS_MS = 10_000;
/** One clipped screenshot of a forced state. */
const PROBE_SHOT_MS = 10_000;
/** Decoding the capture, cutting crops, writing JSON — node-side work. */
const PROBE_WRITE_MS = 10_000;
/** An element already in flight at a deadline: its forces, measures and shots. */
const PROBE_OVERRUN_MS = 8 * PROBE_CALL_MS + 3 * PROBE_SHOT_MS;
const PROBE_SWEEP_WIDTHS = 4;
const PROBE_VIEWPORT_MS =
  PROBE_COLLECT_MS + PROBE_RINGS_MS + PROBE_OVERRUN_MS + PROBE_WRITE_MS + RENDERER_PROBE_MS;
const PROBE_SWEEP_MS = PROBE_CALL_MS + PROBE_COLLECT_MS + PROBE_WRITE_MS + RENDERER_PROBE_MS;
function probeBudgetMs(viewportCount: number): number {
  return (
    viewportCount * PROBE_VIEWPORT_MS +
    PROBE_STATES_MS +
    PROBE_OVERRUN_MS +
    PROBE_SWEEP_WIDTHS * PROBE_SWEEP_MS
  );
}
/** Control signatures this worker has already photographed for the state atlas. */
const PROBE_ATLAS_SEEN = new Set<string>();
let pixelProbe: Promise<typeof import("../scripts/pixel-probe/probe.mjs")> | undefined;

function probeContext(page: Page, capture: string, scheme: "light" | "dark", width: number) {
  return {
    capture,
    scheme,
    width,
    states: width === VIEWPORTS[1].width,
    targets: width === VIEWPORTS[0].width || width === TABLET_VIEWPORT.width,
    titlePath: test.info().titlePath,
    testFile: test.info().file,
    // The spec that registered the test: `titlePath[0]`, relative to `testDir`.
    entryFile: `e2e/${test.info().titlePath[0]}`,
    exhaustiveAudit: process.env.VISUAL_EXHAUSTIVE_AUDIT === "1",
    initialPaintAudit: process.env.VISUAL_AUDIT_INITIAL_PAINT === "1",
    atlasSeen: PROBE_ATLAS_SEEN,
    bound: <T>(what: string, ms: number, work: Promise<T>, degraded: T) =>
      withRendererBound(page, what, ms, work, degraded),
    budgets: {
      collectMs: PROBE_COLLECT_MS,
      callMs: PROBE_CALL_MS,
      statesMs: PROBE_STATES_MS,
      ringsMs: PROBE_RINGS_MS,
      shotMs: PROBE_SHOT_MS,
    },
  };
}

/**
 * A test that runs a real flow — a booking, a mutation and its revert, a crawl
 * of the schedule board — before it can shoot anything. The surface ceiling
 * plus the flow, derived so it tracks the budgets the same way.
 */
const FLOW_ALLOWANCE_MS = 15_000;
export const FLOW_TIMEOUT_MS = SURFACE_TIMEOUT_MS + FLOW_ALLOWANCE_MS;

/**
 * **Each step's own bound, under the test's.** The ceilings above are sums of
 * bounded paint waits, sized so a capture that degrades still shoots. They were
 * never meant to bound a *flow step*: Playwright leaves `actionTimeout` and
 * `navigationTimeout` at 0, so a `click()`, a `locator.waitFor()` or a
 * `waitForURL` whose element or address never arrives waited out the whole
 * test — "Test timeout of 230000ms exceeded" on a capture whose heading had
 * been renamed, almost four minutes of a shard for a deterministic break.
 *
 * Bounded here, a missing element fails in 15s with Playwright's own message
 * naming the locator. 15s is the bound every client-fill and hash-landing wait
 * in this file already uses, and the whole budget of an ordinary flow test
 * (playwright.config.ts); a navigation gets 30s, twice that, for a cold heavy
 * page on a loaded runner. An explicit `{ timeout }` at a call site still wins,
 * and the paint waits above are bounded on their own, so this shortens no
 * passing capture.
 */
export const VISUAL_STEP_BOUNDS = { actionTimeout: 15_000, navigationTimeout: 30_000 } as const;

/** The seeded reef charter, the departure most of the staff tour hangs off. */
export const REEF_TRIP = "Two-Tank Reef — Molasses & French";

/** The demo's night charter: 7:30 PM to 11:00 PM, in the water after dark. */

/**
 * A departure far enough out that D18's re-entry offers are still worth making.
 *
 * `reEntryWindowOpen` closes inside 24 hours, because nobody can act on an ask
 * that late, and `REEF_TRIP` is the demo's *today* boat — about five hours out
 * on the frozen clock, so the offers are correctly suppressed on it and a
 * capture there would photograph a block that is not present. This one sails
 * two days out (`seed-more-trips`, `at(2, 11, 0)`).
 */
export const EASING_BACK_TRIP = "Two-Tank Reef — French Reef";

/** The seeded long-range run that only sails with six (src/db/seed-minimum-seats.ts). */
export const MINIMUM_SEATS_TRIP = "Long-Range Day — Duane & Outer Reef";

/**
 * The three cert-gate departures from `src/db/seed-cert-gates.ts`. Each one can
 * be refused for exactly one reason, which is what lets a refusal capture show
 * a single sentence rather than three overlapping ones. They sit on days 29-32,
 * deliberately off the public schedule's first page — so reaching one means
 * crawling the staff board (`findTripOnBoard`), which is why every test below
 * that uses them buys extra budget.
 */
export const ADVANCED_CHARTER = "Advanced Drift — French Reef Wall";
export const DEEP_CHARTER = "Deep Adventure — USCGC Duane";
export const AOW_COURSE = "Advanced Open Water Diver — two-day course";

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
export async function withRendererBound<T>(
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
    revealPasses,
    revealStamped,
  } = await withRendererBound(
    page,
    "the scroll-through and image settle",
    PAINT_STALL_MS,
    page.evaluate(
      async ({
        frameWaitMs,
        scrollBudgetMs,
        imageSettleMs,
        pendingRevealSelector,
        revealMarkerAttribute,
        revealReadyAttribute,
      }) => {
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
        //
        // One deadline for every pass, not one each: the corrective pass below
        // shares this budget, so a page that needs a second sweep cannot cost
        // more wall-clock than a page that needs one, and `PAINT_STALL_MS` goes
        // on meaning what it says.
        const scrollThrough = async () => {
          // Checked before the first step and again before the reset, not only
          // after each step: a pass entered with the budget already spent still
          // cost a `scrollTo` and a full `settle`, so a page that used the whole
          // 20s in its first sweep could overrun it in the corrective one
          // (sourcery-ai on #1950).
          if (performance.now() >= deadline) return;
          for (let step = 0; step < 100; step += 1) {
            const y = step * window.innerHeight;
            if (y >= document.documentElement.scrollHeight) break;
            window.scrollTo(0, y);
            await settle();
            if (performance.now() > deadline) break;
          }
          if (performance.now() >= deadline) return;
          window.scrollTo(0, 0);
          await settle();
        };

        // **Let the page finish deciding what to hide, before scrolling past
        // it.** `MarketingSectionMotion` withholds its below-fold sections in a
        // layout effect, so nothing is withheld until React hydrates, and the
        // scroll-through below is what gives them back. Racing those two is the
        // whole of issue #1910: the sweep passed an unmarked page, hydration
        // then hid every chapter, and nothing scrolled again before the shutter.
        //
        // The marker is server-rendered, so its absence is an answer rather than
        // a page that has not got there yet — every surface without a reveal on
        // it pays one `querySelector` and moves on. Bounded by the same scroll
        // deadline as everything else here: a page that never stamps is not
        // waited on forever, it simply reaches the tripwire at the end of this
        // function, which is the loud failure this all exists to produce.
        let revealStamped = true;
        if (document.querySelector(`[${revealMarkerAttribute}]`) !== null) {
          while (
            !document.documentElement.hasAttribute(revealReadyAttribute) &&
            performance.now() < deadline
          ) {
            await settle();
          }
          revealStamped = document.documentElement.hasAttribute(revealReadyAttribute);
        }
        await scrollThrough();

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

        // **A section that never revealed photographs as nothing at all.**
        //
        // `MarketingSectionMotion` (src/components/MarketingReveal.tsx) marks
        // every below-fold `main section` `.marketing-reveal-pending` —
        // `opacity: 0` in its base style, globals.css — and clears it from an
        // IntersectionObserver as the reader arrives. The scroll-through above
        // *is* that arrival, so the two race: it marks them in a **layout
        // effect**, so nothing is marked until the page hydrates, and the scroll
        // wins only if hydration got there first. When it does not, the sweep
        // passes an unmarked page, hydration then hides every chapter, and
        // nothing scrolls the page again before the shutter.
        //
        // That is `product-dark-vw-390`'s baseline at `df88bf4`: a hero (above
        // the fold at mount, so never marked), nine thousand blank pixels, and a
        // footer (outside `<main>`, so outside the component's own query). It
        // reached a baseline rather than a red job because a pending section
        // owns **no animation** — `waitForEntranceAnimations` commits the ones
        // that exist, and there is nothing here to commit and nothing to warn
        // about. Unrelated branches then paid a 40% diff on a page they had
        // never touched (issue #1910).
        //
        // Scrolling again is the honest correction rather than forcing the class
        // on: the observer exists by now, so a second sweep reveals them the way
        // a reader would, and the capture stays a photograph of what the app
        // does rather than of what the harness wishes it did. Every other
        // capture in the suite pays one `querySelectorAll` for it.
        //
        // **Counted by what they hide, not by how many wear the class.** A
        // zero-area `<section>` can never satisfy the observer's
        // `threshold: 0.01` — an intersection ratio of nothing over nothing is
        // not 1% of anything — so it keeps the class for the page's whole life.
        // It also hides nothing, having no box to hide, and sweeping the
        // document twice for it on every marketing capture and then refusing the
        // shot would be a guard firing at its own blind spot.
        const hidingSomething = () =>
          Array.from(document.querySelectorAll(pendingRevealSelector)).filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          }).length;
        let revealPasses = 0;
        while (hidingSomething() > 0 && revealPasses < 2) {
          revealPasses += 1;
          await scrollThrough();
        }

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
        return {
          stalled,
          unsettled,
          scrolledAway: window.scrollY !== 0,
          revealPasses,
          revealStamped,
          pendingReveals: hidingSomething(),
        };
      },
      {
        frameWaitMs: FRAME_WAIT_MS,
        scrollBudgetMs: SCROLL_BUDGET_MS,
        imageSettleMs: IMAGE_SETTLE_MS,
        pendingRevealSelector: PENDING_REVEAL_SELECTOR,
        revealMarkerAttribute: REVEAL_MARKER_ATTRIBUTE,
        revealReadyAttribute: REVEAL_READY_ATTRIBUTE,
      },
    ),
    // A stalled pass painted nothing it can report on, and the warnings
    // below would be lying if they claimed a count; `withRendererBound` has
    // already said what happened.
    {
      stalled: 0,
      unsettled: 0,
      scrolledAway: false,
      revealPasses: 0,
      revealStamped: true,
      pendingReveals: 0,
    },
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
  if (!revealStamped) {
    console.warn(
      `visual: ${page.url()} carries the marketing reveal but never stamped ` +
        `\`${REVEAL_READY_ATTRIBUTE}\` within the scroll budget — its sections were scrolled past ` +
        "before the page had finished deciding what to hide, which is the race of issue #1910. The " +
        "corrective sweep and the tripwire below still speak for the result; this names the cause.",
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
  // Last, because the scroll above is what starts the entrance animations and
  // a font swap can start more: whatever is still running has been started by
  // this pass. See `waitForEntranceAnimations` for the measured case (#1380).
  await waitForEntranceAnimations(page);

  // **The tripwire, at the last moment there is.**
  //
  // The corrective sweep above is the fix; this is the check that the fix
  // worked, and it is deliberately the final thing `paintWholeDocument` does.
  // Anything still pending here is about to be photographed at `opacity: 0`,
  // and the whole cost of issue #1910 was that such a capture said nothing at
  // all on its way to becoming a baseline — so this **throws** where the
  // warnings above only warn. A blank chapter is not a diff to triage; it is a
  // capture that did not happen.
  //
  // Re-queried rather than reusing the count from the evaluate above, because
  // the font settle and the animation settle both run in between, and a late
  // hydration landing in that window is precisely the race being closed.
  //
  // Bounded like every renderer-dependent call (`TRIPWIRE_STALL_MS`). On a
  // stall it reads as nothing pending: a renderer that cannot count elements
  // cannot photograph them either, and `screenshotOrGiveUp` fails that shot
  // with the verdict CI's rerun gate reads.
  const stillPending = await withRendererBound(
    page,
    "the pending-reveal tripwire",
    TRIPWIRE_STALL_MS,
    page.evaluate(
      // Same "hides something" count as the sweep above, and for the same reason:
      // a zero-area section keeps the class forever and conceals nothing.
      (selector) =>
        Array.from(document.querySelectorAll(selector)).filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }).length,
      PENDING_REVEAL_SELECTOR,
    ),
    0,
  );
  if (stillPending > 0) {
    throw new Error(
      `visual: ${stillPending} marketing section(s) at ${page.url()} were still ` +
        `\`${PENDING_REVEAL_SELECTOR}\` after ${revealPasses + 1} scroll-through(s). They hold ` +
        "`opacity: 0` and would photograph as blank bands — see issue #1910, where exactly that " +
        "became the `product-dark-vw-390` baseline. The reveal is driven by an " +
        "IntersectionObserver that `MarketingSectionMotion` sets up in a layout effect; if this " +
        "fires, find what is keeping it from running rather than raising the pass count.",
    );
  }
}

/**
 * `page.screenshot`, raced against `SCREENSHOT_GIVE_UP_MS` on the driver side —
 * see that constant for the measured incident proving the call's own `timeout`
 * option does not fire on a renderer that has stopped answering. A shot that
 * never returns gets the same alive-probe `withRendererBound` runs, so the
 * thrown error says which half is broken: "wedged, not slow" is the verdict
 * ci.yml's visual job reads to earn a one-shot rerun of the failed captures.
 */
const visualBuild = captureBuildBoundary(requireFreshBuild);
export function installVisualBuildGuard() {
  test.beforeAll(() => visualBuild.begin());
  test.afterAll(() => visualBuild.end());
  test.beforeEach(({ context }) => tileShopPhotos(context));
}

/**
 * **A shop photo is one flat tile in every capture** (H-157, issue #2937).
 * The photo strip under the storefront's cover is the shop's own seed-stock
 * photographs, and they kept reporting "changed" with the same four photos on
 * both sides: JPEG decode and resample noise that three corrections above did
 * not close. A reviewer is checking the layout around the photos, never their
 * pixels, so every request for one of the demo shop's strip photos (as a file
 * or through `/_next/image`) is answered with {@link SHOP_PHOTO_TILE}, which
 * fills its `object-cover` box as one colour on every run. The real photos are
 * proved to load, at a size and with their alt attribute, by a non-visual test:
 * `e2e/storefront-brand.spec.ts`. Pages from a context a spec opens itself
 * still load the real files; no capture of the strip does that today.
 */
export const SHOP_PHOTO_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR42mOIrurBihgGUgIAXJNCMW/U1hoAAAAASUVORK5CYII=",
  "base64",
);
/** Compared decoded, so a browser's own escaping of a space or a comma cannot miss a photo. */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
const SHOP_PHOTO_PATHS = new Set(DEMO_SHOP_BRAND.shopfrontPhotoUrls.map(decodedPath));

export function isShopPhotoRequest(url: URL): boolean {
  if (url.pathname === "/_next/image") {
    const source = url.searchParams.get("url");
    return source !== null && SHOP_PHOTO_PATHS.has(decodedPath(source));
  }
  return SHOP_PHOTO_PATHS.has(decodedPath(url.pathname));
}

async function tileShopPhotos(context: BrowserContext) {
  await context.route(isShopPhotoRequest, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: SHOP_PHOTO_TILE }),
  );
}

async function assertCaptureState(page: Page) {
  const build = visualBuild.current();
  if (
    process.env.VISUAL_ROUTE &&
    !matchesRoute(process.env.VISUAL_ROUTE, new URL(page.url()).pathname)
  ) {
    throw new Error(
      "Capture did not reach its declared route template; no screenshot evidence written.",
    );
  }
  if (process.env.VISUAL_EXPECT)
    await expect(page.locator(process.env.VISUAL_EXPECT)).toBeVisible();
  return build;
}

async function recordCapture(
  page: Page,
  image: string,
  build: ReturnType<typeof requireFreshBuild>,
) {
  writeCaptureEvidence({
    directory: process.env.VISUAL_EVIDENCE_DIR ?? "test-results/visual-evidence",
    image,
    build,
    viewport: page.viewportSize(),
    browser: page.context().browser()?.version(),
    title: test.info().titlePath,
    locale: await readerLanguage(page),
    contract: process.env.VISUAL_EXPECT
      ? {
          route: process.env.VISUAL_ROUTE,
          role: process.env.VISUAL_ROLE,
          fixture: process.env.VISUAL_FIXTURE,
          state: process.env.VISUAL_STATE,
          expectedVisible: process.env.VISUAL_EXPECT,
        }
      : null,
  });
}

async function screenshotOrGiveUp(page: Page, path: string) {
  const build = await assertCaptureState(page);
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
  if (outcome.state === "done") {
    await recordCapture(page, path, build);
    return;
  }

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
 * Waits out every running (finite) CSS animation — the
 * `document.getAnimations()` pattern the removed `e2e/a11y.spec.ts` used to settle a
 * *paint* rather than a *duration*. The command palette gained a real
 * `animate-scale-in`/`animate-fade-in` entrance in issue #832 where it
 * previously had none, and `capture()` shoots the instant its input is
 * focused — mid-transform, not at rest. Exact and not a timing guess:
 * `animate-pulse` skeletons and other infinite animations are excluded so a
 * still-loading surface never hangs this wait.
 *
 * **It runs for every capture, at the end of `paintWholeDocument`** (issue
 * #1380), because the palette was never the only surface that animates on the
 * way in. `screenshotOrGiveUp` passes Playwright's `animations: "disabled"`,
 * which fast-forwards what it can see, and the marketing pages proved that is
 * not the whole answer: on a pull request touching only the shop home,
 * `product-light-vw-1280` and `product-light-vw-390` came back changed, 5,856
 * of 5,947 differing pixels by one to three colour units, every one of them on
 * the antialiased border and bed shadow of one `MarketingSectionMotion` card,
 * with the text inside identical and the dark capture of the same page
 * passing. That is a `rise-in` photographed a frame from its end state, and
 * the shutter lands there deterministically per commit, so a re-run cannot
 * clear it and the next unrelated branch pays the triage again. The scroll
 * `paintWholeDocument` runs is what starts those reveals, so the settle
 * belongs at the end of it: the same pass that triggers them waits them out.
 *
 * Bounded like every other wait here. A finite animation that never finishes
 * (paused, or on an element the renderer has stopped ticking) degrades to a
 * shot taken anyway with a warning, never a hang that costs the run.
 *
 * **Finished is not the same as gone, and the difference is the flake.** An
 * entrance here is written `both`, so the animation object outlives its own
 * duration: `animation.finished` resolves, `getAnimations()` still lists it,
 * and Chromium keeps the element on the compositing layer it promoted for the
 * transform. A layer composites its own antialiased edges and its `shadow-bed`
 * blend, so those pixels round twice — once into the layer, once onto the page
 * — where an unpromoted element rounds once. Demotion happens some later
 * frame, and the shutter races it.
 *
 * That is issue #1597, and it is measured rather than argued: six runs of the
 * product page from one build produced exactly **two** byte-exact variants,
 * flipping two runs in six, 6,527 pixels differing by **one unit** on the card
 * edges and bed shadows of the `readiness` chapter with a **zero** height
 * delta. It is the same band, the same page and the same one-to-three units as
 * #1380, which `waitForEntranceAnimations` was written for — waiting the
 * animation out closed the mid-flight half and left this one open, which is
 * why the captures kept reporting changed on pull requests that cannot reach
 * the product page.
 *
 * So each finite animation is **committed and cancelled** rather than merely
 * awaited: `commitStyles()` writes its computed end values as inline styles
 * and `cancel()` then removes the animation, and with it the layer. Nothing
 * moves — the committed style *is* the end state — and the shutter no longer
 * has a promotion to race. `commitStyles()` is what makes this safe where the
 * docblock below rules out `animation: none`: `.marketing-reveal-pending`
 * holds `opacity: 0` in its base style and relies on the animation's fill to
 * become visible, and committing first is exactly what carries that fill onto
 * the element before the animation goes.
 *
 * Per-animation `try`/`catch`, because `commitStyles()` throws for a target
 * that is not rendered or is a pseudo-element, and one such throw must not
 * cost the capture. Infinite animations are left alone: an `animate-pulse`
 * skeleton has no end state to commit, and Playwright's `animations:
 * "disabled"` already resets it to its first frame at shutter time.
 */
async function waitForEntranceAnimations(page: Page) {
  await withRendererBound(
    page,
    "the entrance-animation settle",
    ANIMATION_STALL_MS,
    page.evaluate(
      (ms) =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
              )
              .map((animation) => animation.finished.catch(() => undefined)),
          ).then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(true), ms)),
        ]),
      ANIMATION_WAIT_MS,
    ),
    true,
  );

  await withRendererBound(
    page,
    "the entrance-animation commit",
    ANIMATION_STALL_MS,
    page.evaluate((frameMs) => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY) continue;
        // **A scroll-driven animation is not finished, it is *positioned*.**
        // `animation-timeline: scroll(root block)` drives the staff bar's fold
        // from the scroll offset rather than from a clock (globals.css), and
        // such an animation reports finite iterations like any other — so
        // cancelling it here froze the label at whatever scroll 0 had written,
        // and `captureFolded` then waited forever for an opacity that could no
        // longer change. That is the failure `captureFolded`'s own docblock
        // predicts for `animations: "disabled"`, arriving by a different door.
        //
        // Compared against `document.timeline` rather than sniffing a class
        // name: the document's monotonic timeline is the only one whose end
        // state is a *time* the shutter can be after.
        if (animation.timeline !== document.timeline) continue;
        try {
          animation.commitStyles();
          animation.cancel();
        } catch {
          // A target that is not rendered, or a pseudo-element: nothing to
          // commit and nothing promoted to demote.
        }
      }
      // Two frames for the demotion the cancel above asked for, so the shutter
      // lands after it rather than during it — raced against a timeout like
      // every other frame wait here, because `requestAnimationFrame` is not a
      // promise the page owes you.
      return Promise.race([
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        }),
        new Promise((resolve) => setTimeout(() => resolve(true), frameMs)),
      ]);
    }, FRAME_WAIT_MS),
    true,
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
 * `MarketingReveal`, `useExitAnimation` — and the
 * suite would quietly stop photographing the app
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
 * **Wait for a fragment-opened page to have finished scrolling itself.**
 *
 * A `page.goto("/x#y")` scrolls twice: the browser's own fragment navigation
 * runs first, and `ScrollToHash` (`src/components/ScrollToHash.tsx`) scrolls
 * again on mount, because a Next client transition would otherwise leave the
 * anchor a thousand pixels below the fold. Between those two the page is at a
 * scroll position neither of them chose.
 *
 * That matters here and almost nowhere else. Chromium paints a `position:
 * fixed` element into the strip that is under it when that strip is
 * rasterized, so a full-page screenshot taken across the two scrolls stitches
 * the shop header and the staff dock at whatever offset it caught — which is
 * how `trip-guests-deal-seeded` reported itself changed on a branch whose whole
 * diff was vitest sharding, with 234 of 2,529 rows differing and a **0.0%**
 * cross-match proving the bands had relocated rather than re-rendered (issue
 * #1304).
 *
 * `paintWholeDocument`'s own `scrollTo(0, 0)` closes the window *after* the
 * second scroll; this closes it before the first screenshot is even prepared,
 * so there is one scroll to settle rather than two to race. Call it after the
 * usual content wait and before `capture`, on any surface opened at a
 * `#fragment`.
 *
 * It is not a timing guess: `ScrollToHash` stamps `data-hash-landed` in every
 * branch it can return through, including the ones that scroll nothing, so
 * this resolves on the page's own signal or fails saying the page never sent
 * one.
 */
export async function waitForHashLanding(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.hasAttribute("data-hash-landed"),
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Runs `shoot` with {@link CAPTURE_TRANSITIONS_OFF} installed, and takes it
 * back out afterwards. Scoped rather than global because the tests keep running
 * after a capture: `useExitAnimation` and friends wait on a real `transitionend`
 * to unmount, and a transition that never runs never fires one.
 */
export async function withTransitionsOff<T>(page: Page, shoot: () => Promise<T>): Promise<T> {
  const style = await page.addStyleTag({ content: CAPTURE_TRANSITIONS_OFF });
  try {
    return await shoot();
  } finally {
    // The page may already be navigating or closed if `shoot` threw; losing the
    // cleanup then is harmless, and must not mask the original failure.
    await style.evaluate((node) => node.parentNode?.removeChild(node)).catch(() => undefined);
  }
}

/**
 * **The one language other than English these baselines are rendered in**
 * (issue #1681).
 *
 * Spanish strings here are systematically longer than their English siblings
 * and the words are chosen deliberately (`src/i18n/locales/es-ES/README.md`),
 * so a layout that fits in English is untested in the language most likely to
 * break it. Nothing in this file had ever rendered one: the only non-default
 * locale block is `de-DE`, and that is a language DiveDay carries **no bundle
 * for** — it photographs the unsupported-language band, not translated copy.
 *
 * A constant rather than a parameter over every locale, for the same reason
 * `TABLET_SURFACES` is a set: capturing everything twice is another 480
 * screenshots and the triage burden to match, so which surfaces earn a second
 * language is a decision a reviewer can argue with in one place.
 *
 * **No ledger row.** `scripts/route-coverage.json` names the *surface*, and
 * `parseCaptureNames` reads the first argument of each `capture()` call — so a
 * Spanish sibling is already covered by its English name and adding an
 * `-es-ES` row would name a capture no call produces.
 */
export const SPANISH = "es-ES" as const;

/**
 * How a Spanish capture is *reached*, which is not one mechanism but two — and
 * the reason the switch cannot live inside {@link capture}.
 *
 * - **The staff surfaces negotiate per request.** `requestLocale` reads the
 *   reader's own `diveday_locale` cookie first, then `Accept-Language`, then
 *   the shop's stored default (ADR 20260812-reader-chosen-language). A
 *   `test.use({ locale })` block sets the header for every request the context
 *   makes, which is as deterministic as the frozen clock and is the whole
 *   switch for these.
 * - **The offline manifest negotiates from the device.** It renders entirely
 *   client-side from an encrypted IndexedDB snapshot with the radio off, so
 *   there is no request to carry a cookie or a header: `translatorForThisDevice`
 *   (`src/components/OfflineManifestView.tsx`) reads `navigator.language`. A
 *   cookie reaches it never.
 *
 * `test.use({ locale })` sets both, which is why one describe block covers all
 * three surfaces — and why each capture below asserts what the page itself
 * reports rather than what the block asked for.
 */
async function readerLanguage(page: Page): Promise<string> {
  return withRendererBound(
    page,
    "reading navigator.language",
    5_000,
    page.evaluate(() => navigator.language),
    "unknown",
  );
}

/**
 * **Client-filled state the server cannot draw, settled before any shot.**
 * Each of these is a mark a component publishes once its own fill has landed,
 * so the wait is on the state being photographed, not on a clock (#2509):
 *
 * - `[data-section-preview]` without `data-preview-ready`: an editor
 *   section's folded preview line, read off its fields after hydration.
 *   `course-edit` light at 390 came back with every folded line blank on one
 *   run and filled on the next.
 * - `[data-offline-copy="pending"]`: the "On this phone" card before the
 *   mount's first save to this device has landed, which is whenever the
 *   service worker answers. `manifest-running-late` dark at 390 came back
 *   with "Online" alone on one run and "Online · Fresh copy" on the next.
 *
 * Every capture helper calls this, so the next surface that shows either
 * component is covered without a per-capture selector.
 */
async function waitForClientFills(page: Page) {
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-section-preview]:not([data-preview-ready]), [data-offline-copy="pending"]',
      ),
    undefined,
    { timeout: 15_000 },
  );
}

export async function capture(
  page: Page,
  name: string,
  scheme: "light" | "dark",
  options: {
    locale?: typeof SPANISH;
    /** One-off audit of actual SSR fallbacks with application JavaScript off. */
    initialPaint?: true;
    /** Explicit acceptance coverage at phone width in dark, leaving the default matrix unchanged. */
    darkPhone?: true;
    /**
     * Run after each width is set and before it is shot, for a mark that does
     * not survive a resize: a focus ring on a field that a narrower width
     * folds away loses its focus there and does not get it back.
     */
    beforeShot?: () => Promise<void>;
    /** Runs after map resizing and document paint so transient labels remain visible. */
    beforeScreenshot?: () => Promise<void>;
  } = {},
) {
  // A second language is a second baseline, never a replacement: the English
  // one keeps its name and its history, and the reviewer sees a new item.
  const baseline = options.locale ? `${name}-${options.locale}` : name;
  if (options.locale) {
    // The footgun this closes: a capture named for a locale the page is not
    // being read in photographs English under a Spanish baseline name, and
    // nothing anywhere fails. Asked of the page rather than of the fixture,
    // because the page is what rendered.
    const reading = await readerLanguage(page);
    if (reading !== options.locale) {
      throw new Error(
        `capture(${name}) asked for ${options.locale} but the page reports navigator.language ` +
          `"${reading}" — the locale comes from a test.use({ locale }) block, not from here.`,
      );
    }
  }
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
  //
  // `[data-suspense-placeholder]` covers the same trap *outside* `<main>`: the
  // public shop layout streams its whole chrome — header and the staffer's
  // "you work here" bar — behind a boundary whose fallback is a bare band
  // holding the height. That band is not a pulse and not in `<main>`, so
  // neither half of the rule above could see it, and a capture fired while it
  // stood photographed a header with no shop name. It is not hypothetical:
  // `public-schedule-new-shop-dark` came back with the placeholder at vw-390
  // and the real chrome at vw-1280 — the same page, one second apart.
  if (options.initialPaint) {
    await expect(page.locator(INITIAL_PAINT_FALLBACK).filter({ visible: true })).not.toHaveCount(0);
  } else {
    await page.waitForFunction(
      () =>
        !document.querySelector(
          "main .animate-pulse:not([data-live-pulse]), [data-suspense-placeholder]",
        ),
      undefined,
      {
        timeout: 15_000,
      },
    );
  }
  // Settings' rail moves to the current row from an effect, after the page has
  // painted, so a capture could catch it at its top or on the row depending on
  // the run (`settings-embed`). The rail marks itself once it has moved.
  if (!options.initialPaint) {
    await page.waitForFunction(
      () => !document.querySelector("[data-settings-rail-scroller]:not([data-rail-settled])"),
      undefined,
      { timeout: 15_000 },
    );
    await waitForClientFills(page);
  }
  // The standard pair, plus the portrait tablet for the five staff surfaces a
  // shop runs on one. Widest last is deliberate: the base viewport is restored
  // below either way, but a capture that fails mid-loop leaves the page at a
  // width a trace viewer can make sense of.
  // Keyed on the baseline name, so a Spanish sibling takes the standard pair
  // rather than inheriting a third width: those sets are about the *device* a
  // surface runs on, and a second language has nothing new to say at 820px
  // that it does not say louder at 390.
  // Dark takes desktop alone unless this capture explicitly needs dark phone acceptance.
  const viewports = [
    ...schemeViewports(scheme, options.darkPhone),
    ...(scheme === "light" && TABLET_SURFACES.has(baseline) ? [TABLET_VIEWPORT] : []),
  ];
  // Light only: geometry does not change with the scheme, and checking one
  // scheme is the owner's standing rule for anything that is not colour work.
  // The import happens here, inside the flag, so an unset flag loads nothing.
  if (PIXEL_PROBE && scheme === "light") pixelProbe ??= import("../scripts/pixel-probe/probe.mjs");
  const probe = PIXEL_PROBE && scheme === "light" ? await pixelProbe : undefined;
  if (probe) test.info().setTimeout(test.info().timeout + probeBudgetMs(viewports.length));
  await withTransitionsOff(page, async () => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await options.beforeShot?.();
      if (options.initialPaint) {
        await expect(
          page.locator(INITIAL_PAINT_FALLBACK).filter({ visible: true }),
        ).not.toHaveCount(0);
      }
      await paintWholeDocument(page);
      await options.beforeScreenshot?.();
      const shot = `e2e/screenshots/${baseline}-${scheme}-vw-${viewport.width}.png`;
      await screenshotOrGiveUp(page, shot);
      // After the shot and before the next resize, so nothing the probe does
      // can reach a baseline; `probeViewport` never throws.
      if (probe) {
        await probe.probeViewport(page, {
          ...probeContext(page, baseline, scheme, viewport.width),
          shot,
        });
      }
    }
    // The width sweep, after every captured width has been shot.
    if (probe) await probe.probeSweep(page, probeContext(page, baseline, scheme, 0));
    // capture() runs mid-flow (navigation and clicks continue after it), so
    // restore the base viewport the test was using before resizing for each
    // capture above — matching what the old Argos `viewports` option did.
    // Inside the switch-off, so the last resize does not leave a transition
    // running into whatever the test does next.
    if (baseViewport) await page.setViewportSize(baseViewport);
  });
  if (scheme === "light" && !options.initialPaint) {
    await auditInitialPaint(page, baseline, withRendererBound, (initialPage, initialName) =>
      capture(initialPage, initialName, "light", { initialPaint: true }),
    );
  }
}

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
export async function captureStickyFoot(page: Page, name: string, scheme: "light" | "dark") {
  const baseViewport = page.viewportSize();
  await waitForClientFills(page);
  // The same widths as `capture()` — both in light, where the phone is the case
  // a bar pinned to the bottom edge earns its place; desktop alone in dark.
  await withTransitionsOff(page, async () => {
    for (const viewport of schemeViewports(scheme)) {
      await page.setViewportSize(viewport);
      await paintWholeDocument(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // The scroll is a layout change like any other; let it commit before the shot.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const build = await assertCaptureState(page);
      const shot = `e2e/screenshots/${name}-${scheme}-vw-${viewport.width}.png`;
      await page.screenshot({
        path: shot,
        animations: "disabled",
      });
      await recordCapture(page, shot, build);
    }
    if (baseViewport) await page.setViewportSize(baseViewport);
  });
}

/**
 * **The bar, folded** — ADR 20260907-nothing-from-nowhere, decision 5.
 *
 * A phone-width viewport shot at a scroll position, because both halves of the
 * subject need it: the fold only runs below `lg`, and it only *has* a state
 * worth photographing once the page has scrolled past 120px. `capture()` cannot
 * take this — it shoots the whole document at scroll 0, which is the one
 * position where the fold has deliberately done nothing.
 *
 * No `animations: "disabled"`: this animation's progress comes from the scroll
 * offset, not from a clock, so at a fixed scroll it is already stationary and
 * there is nothing to freeze. Disabling it would jump the label to its end
 * state at *any* scroll, which would photograph the same picture whether the
 * mechanism worked or not.
 *
 * The wait is on the label's own computed opacity reaching 1 — the state the
 * shot is of, not a guess at how long it takes to get there.
 */
export async function captureFolded(page: Page, name: string, scheme: "light") {
  const baseViewport = page.viewportSize();
  await waitForClientFills(page);
  await withTransitionsOff(page, async () => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await paintWholeDocument(page);
    // Past the 120px range, so the fold is complete rather than mid-cross.
    await page.evaluate(() => window.scrollTo(0, 240));
    await page.waitForFunction(() => {
      const slot = document.querySelector("[data-chrome-title-slot]");
      const name = document.querySelector("[data-chrome-shop-name]");
      if (!slot || !name) return false;
      return getComputedStyle(slot).opacity === "1" && Number(getComputedStyle(name).opacity) === 0;
    });
    const build = await assertCaptureState(page);
    const shot = `e2e/screenshots/${name}-${scheme}-vw-390.png`;
    await page.screenshot({ path: shot });
    await recordCapture(page, shot, build);
    if (baseViewport) await page.setViewportSize(baseViewport);
  });
}

/**
 * Capture a surface as it renders for the printer. Emulating `print` media
 * applies the whole `@media print` treatment — monochrome tokens, page
 * padding, `print:hidden` chrome removed — so the baseline is the document a
 * shop actually prints, not the interactive page. One shot at the current
 * (Letter-width) viewport: print output is scheme- and viewport-independent, so
 * the light and dark widths the on-screen `capture` runs would be
 * three identical copies here. `@page` margins never show in a screenshot; the
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
 *
 * **A sheet is the exception, twice over** (`SheetDocument`). It states its
 * own paper in `style[data-print-sheet]`, so the Letter override would name
 * the wrong paper, and its box is a fixed size in millimetres that can be
 * wider than Letter: the A3 dock sign is 285mm, 1,077px, and at 816px its
 * frame scrolled the last 261px out of the shot while `body`'s
 * `overflow-x: clip` hid the loss (pixel probe, dock-sign-print). So a sheet
 * keeps its own `@page`, the viewport widens by however far a sheet's frame
 * scrolls sideways, and a sheet still cut off after that throws rather than
 * becoming a baseline. A sheet narrower than Letter is shot at 816px as
 * before.
 */
export async function capturePrint(page: Page, name: string) {
  const baseViewport = page.viewportSize();
  // Switching media repaints the whole document in print tokens, which is a
  // property change like any other and so can start transitions of its own —
  // the same class of race as the resize in `capture()`. Both `emulateMedia`
  // calls, and the resize a wide sheet needs, sit inside the switch-off for
  // that reason.
  await withTransitionsOff(page, async () => {
    await page.emulateMedia({ media: "print" });
    if (process.env.VISUAL_EXHAUSTIVE_AUDIT === "1") {
      // Save real pagination before the screenshot-only long-sheet rule.
      // A6 documents keep their own CSS size; other documents use Letter.
      await paintWholeDocument(page);
      await page.pdf({
        path: `e2e/screenshots/${name}-print.pdf`,
        format: "Letter",
        preferCSSPageSize: true,
        printBackground: true,
      });
    }
    const statesItsOwnPaper = (await page.locator("style[data-print-sheet]").count()) > 0;
    if (!statesItsOwnPaper) {
      await page.addStyleTag({ content: "@page { size: 8.5in 200in; }" });
    }
    // How far the widest sheet runs past the frame holding it. Read after the
    // media switch, because the print frame drops its screen padding.
    const sheetOverflow = () =>
      page.evaluate(() =>
        Math.max(
          0,
          ...Array.from(
            document.querySelectorAll(".paper-sheet-frame"),
            (frame) => frame.scrollWidth - frame.clientWidth,
          ),
        ),
      );
    const overflow = await sheetOverflow();
    const widened = overflow > 0;
    if (baseViewport && widened) {
      await page.setViewportSize({
        width: baseViewport.width + overflow,
        height: baseViewport.height,
      });
    }
    // After the media switch, so the bands rasterized are the print layout's.
    await paintWholeDocument(page);
    const stillCut = await sheetOverflow();
    if (stillCut > 0) {
      throw new Error(
        `visual: a paper sheet at ${page.url()} still runs ${stillCut}px past its frame at a ` +
          `${page.viewportSize()?.width}px viewport, so its print capture would lose its right ` +
          "edge. `capturePrint` widens the viewport by the frame's overflow before painting; " +
          "find what grew after that read rather than widening further.",
      );
    }
    await screenshotOrGiveUp(page, `e2e/screenshots/${name}-print.png`);
    await page.emulateMedia({ media: "screen" });
    if (baseViewport && widened) await page.setViewportSize(baseViewport);
  });
}

// ---------------------------------------------------------------------------
// Shared setup.
//
// One surface per test means the navigation each surface needs is now written
// once here rather than inherited from whatever ran earlier in a tour. These
// only *reach* a surface; every capture site still does its own readiness wait,
// because what proves a page has rendered is a property of that page.

/** The demo's first-light boat: 5:30–8:30 AM against a 9:30 AM clock, so it is home. */
export const SAILED_TRIP = "Dawn Two-Tank — Molasses Reef";

/** The seeded reef charter's card on the public schedule, once it is real. */
export function publicReefCard(page: Page) {
  return page.locator("li").filter({ hasText: REEF_TRIP });
}

/**
 * A seat's dispute sheet, reached the way an owner reaches it: the Orders
 * index narrowed to the history's deposit orders (each raised for a real seat),
 * the first one, then its More menu's "Dispute sheet" door. Waits on the last section's
 * heading so a capture never photographs the skeleton.
 */
export async function openDisputeSheet(page: Page) {
  await page.goto("/shop/blue-mantis/orders?q=Trip+deposit");
  const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
  await ledgerRow.filter({ visible: true }).first().waitFor();
  await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
  // The sheet's door sits in the order header's More menu (visual review A16).
  await page.getByRole("main").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Dispute sheet" }).click();
  await page.getByRole("heading", { level: 2, name: "What staff did" }).waitFor();
}

/** Open the seeded reef charter's staff record, the way staff reach it. */
export async function openReefTrip(page: Page) {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, REEF_TRIP);
}

/**
 * The demo's first-light boat — 5:30–8:30 AM against a 9:30 AM clock, so it is
 * the one departure on today's board that has actually sailed.
 *
 * The Seen group does not exist before a boat leaves, and `REEF_TRIP` is five
 * hours out, so a capture there would photograph an absent section.
 */
export async function openSailedTrip(page: Page) {
  // The day's own spine, not the schedule board: the board lists what is still
  // to come, and this boat is back. The station carries the departure's title
  // as its door (ADR 20260827-clearwater-surface-language, decision 4).
  await page.goto("/shop/blue-mantis");
  await page.getByRole("link", { name: SAILED_TRIP, exact: true }).first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
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
export async function deepDiverLogPath(page: Page): Promise<string> {
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
 * Wait until the offline service worker is *activated*, before navigating into
 * a shell surface that photographs it.
 *
 * `OfflineShellVersionBanner` renders "A newer version of DiveDay is ready"
 * off a `controllerchange` event, which fires exactly once per context: when
 * the worker `primeOfflineManifestShell()` just registered activates and
 * claims its clients. Whether that lands before or after `capture()` is a
 * straight race, and it decided a baseline — `offline-manifest-list-dark`
 * carried the banner on `fc0950b` and not on the run after it, on a commit
 * that touched neither the shell nor the worker.
 *
 * Waiting here rather than on the shell page is the whole point: a navigation
 * that starts against an activated worker is controlled from its first byte,
 * so the shell's banner mounts with nothing left to hear and the surface is
 * photographed in the steady state a crew member actually meets. Masking the
 * banner would have hidden a real control instead.
 *
 * **Activated, not "this page is controlled"** — which is what this waited for
 * until it spent a capture's whole 225s budget waiting (run 36103429213).
 * The two usually arrive together, since `activate` claims every open page,
 * but a page whose own navigation was still in flight at that moment gets
 * neither: it asked for a worker before one was active, so the network
 * answered it, and it was not yet a client `clients.claim()` could take, so
 * nothing ever claims it. The manifest page lands in exactly that window when
 * `openTripTab`'s `goto` leaves while the install the schedule board started
 * is still writing its cache. On that run the install's last fetch finished at
 * 681.00s, the manifest's navigation left unintercepted at 681.10s, the page's
 * own priming found the worker already active at 681.41s — and the page was
 * still uncontrolled 221 seconds later. The worker's state is what the *next*
 * navigation depends on, and it always arrives.
 *
 * Bounded by the expect budget, and a failure says why: the registration's
 * state (`no registration` is a failed `register()` or install, `installing` a
 * stuck install fetch) and the status of the two responses no install survives
 * without. The worker's own requests are the frame-less rows in the trace's
 * network tab; `browser-activity` records only the page's.
 *
 * Only for captures that reach the shell through a primed manifest page. The
 * empty/discarded states deliberately suppress priming, so no worker ever
 * claims them and there is no race to cut.
 */
export async function settleOfflineShellWorker(page: Page) {
  const workerState = () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.getRegistration("/");
      if (!registration) return "no registration";
      const { installing, waiting, active } = registration;
      if (active?.state === "activated") return "activated";
      return `installing ${installing?.state ?? "none"} · waiting ${waiting?.state ?? "none"} · active ${active?.state ?? "none"}`;
    });
  try {
    await expect.poll(workerState).toBe("activated");
  } catch (error) {
    const served = await Promise.all(
      ["/manifest-sw.js", "/offline-manifest"].map(async (path) => {
        const response = await page.request.get(new URL(path, page.url()).toString());
        return `GET ${path} ${response.status()}`;
      }),
    );
    throw new Error(
      `the offline shell's worker never activated: its registration reads "${await workerState()}" (${served.join(", ")})`,
      { cause: error },
    );
  }
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
 * at 390, exactly where the record's jump row lands — so the pointer left
 * behind by the click renders one entry in its hover state, and the phone
 * baselines photographed a "Fit" that looked selected. Deterministic, so never
 * a flake; just a lie about state that a reviewer has to re-derive every time.
 * (0,0) is the demo banner, which has nothing hoverable in the corner.
 */
export async function openDiverProfile(page: Page, search: string, fullName: string) {
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
export async function tripIdWithoutSigningIn(
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
export async function bookAVisualRegressionSeat(page: Page, scheme: "light" | "dark") {
  await page.goto("/s/blue-mantis");
  await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
  await page.getByLabel("Email", { exact: true }).fill(`visual-regression-${scheme}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await page.getByRole("heading", { name: /You’ve got a seat/ }).waitFor();
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
export const PAST_PENDING_GRACE = new Date(
  Date.parse(E2E_FROZEN_CLOCK) - OFFLINE_MANIFEST_PENDING_GRACE_MS - 24 * 60 * 60 * 1000,
).toISOString();

/**
 * A `savedAt` that lands a copy squarely in the "aging" tier — past the
 * 15-minute current threshold, inside the 4-hour stale one — so the list's row
 * reads "Saved 2 hours ago" against the frozen clock. Derived from the same
 * constant the product classifies with, so moving the tier moves this with it
 * rather than leaving the seed on the wrong side of it.
 */
export const AGING_SAVED_AT = new Date(
  Date.parse(E2E_FROZEN_CLOCK) - OFFLINE_MANIFEST_AGING_MS / 2,
).toISOString();

/** A shop that is not the seeded one, for the cross-shop purge. */
export const OTHER_SHOP = { slug: "reef-runners", name: "Reef Runners" };

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
export async function rewriteSavedOfflineRecord(
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
export const IDENTITY_ROUTE = "**/api/offline-manifests/identity*";

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
export async function savedOfflineRecordFor(page: Page): Promise<string> {
  await openReefTrip(page);
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);
  // The same line the sibling captures carry, in the same place: priming just
  // registered a worker, and every caller below navigates into the shell it
  // claims. Without it `OfflineShellVersionBanner`'s `controllerchange`
  // listener can mount before the claim lands and photograph "A newer version
  // of DiveDay is ready" — which is exactly what happened to
  // `offline-manifest-list-needs-refresh-light` on `f58f544`, +118px at 390 and
  // 24% of the 1280 frame, on a commit that renamed an unrelated capture.
  await settleOfflineShellWorker(page);
  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error(`could not read a trip id from ${page.url()}`);
  await page.route(IDENTITY_ROUTE, (route) => route.abort());
  await page.goto("/offline-manifest");
  // The with-trips heading, so this also proves the store was read and the
  // rows are on screen — the empty branch says "No manifest saved on this phone
  // yet" instead, and a rewrite against a record the list never found would
  // throw somewhere less obvious.
  await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
  return tripId;
}
