import type { Page } from "@playwright/test";

/**
 * Shared visual-regression capture helpers, importable from any e2e spec.
 *
 * These used to live only in a dedicated `e2e/visual.spec.ts` "site tour" that
 * re-navigated to a curated list of surfaces from scratch, run in its own
 * single-worker CI job. That kept visual work off the functional suite's
 * existing 4-way shard parallelism and made the tour's shared per-test time
 * budget the single point of failure for every capture in it (see the git
 * history of `e2e/visual.spec.ts` and PR #258 for the flake that motivated
 * this). Tests that want a baseline now call `capture()`/`capturePrint()`
 * directly, tagged `@visual` (see AGENTS.md / the e2e-and-visual skill), and
 * run wherever the functional suite already shards them.
 *
 * Nothing here asserts — `capture()`/`capturePrint()` write raw
 * `page.screenshot()` PNGs into `e2e/screenshots/` (gitignored); `reg-suit`
 * diffs them against the baseline for this branch's parent commit, pulled
 * from S3, and publishes the run (docs ADR 20260729-reg-suit-visual-regression).
 * That is why a "visual failure" never surfaces as a failed Playwright test —
 * it surfaces as a diff in the reg-suit report, and the `visual-triage` skill
 * is how you read it.
 *
 * Stability: these are captured full-page with nothing masked, so a
 * regression anywhere — including in a time or a date — is caught. That is
 * only safe because the clock is frozen on both sides: the server by
 * DIVEDAY_CLOCK (playwright.config.ts → src/lib/clock.ts), so the clock-anchored
 * seed and every render resolve to one fixed instant; the browser by the
 * context-fixture init script in e2e/fixtures.ts, so client-side relative time
 * ("3m ago") agrees with the server. Freeze the clock, never mask the output —
 * masking hides the very pixels a regression would move, and never stabilised
 * the layout shifts (a reordered queue, a trip crossing from upcoming to
 * sailed) that a moving clock actually causes.
 *
 * Every capture site needs the surface to have finished rendering first — wait
 * for a heading, a known element, or (for a Client Component) a control it
 * only renders once mounted. A capture that navigates and shoots immediately
 * photographs whichever frame the suspense fallback was on, and two runs
 * disagreeing about that is what "flaky visual diff" has always turned out to
 * mean here. Waiting on a server-rendered element is not enough when the
 * interesting part is client-rendered.
 */

// Phone first, then desktop — matches scripts/screenshot.mjs. Navigation and
// clicks happen at the desktop base viewport (see viewport in test.use below);
// these only resize the page for the capture itself.
export const VIEWPORTS = [
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

/**
 * Capture `name` at both VIEWPORTS for the given color scheme. Call this from
 * inside a test tagged `@visual` (see e2e-and-visual skill), after waiting for
 * the surface's real content — never the loading fallback — to render.
 */
export async function capture(page: Page, name: string, scheme: "light" | "dark") {
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
  // capture() may run mid-flow (navigation and clicks continuing after it), so
  // restore the base viewport the test was using before resizing for each
  // capture above.
  if (baseViewport) await page.setViewportSize(baseViewport);
}

/**
 * Capture a surface as it renders for the printer. Emulating `print` media
 * applies the whole `@media print` treatment — monochrome tokens, page
 * padding, `print:hidden` chrome removed — so the baseline is the document a
 * shop actually prints, not the interactive page. One shot at the current
 * (Letter-width) viewport: print output is scheme- and viewport-independent, so
 * the light/dark × phone/desktop matrix `capture` runs would be four identical
 * copies here. `@page` margins never show in a screenshot; the padding visible
 * in the baseline is the container's own (`print:px-*`), the gutter that
 * survives a "None margins" print dialog.
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
 * printing keeps its real Letter pagination. Call this with a 816×1056
 * (US-Letter-ish) viewport already set via `test.use`.
 */
export async function capturePrint(page: Page, name: string) {
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
