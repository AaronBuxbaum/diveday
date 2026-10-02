import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Automated a11y scan for the current page state — WCAG 2.0 A/AA plus 2.2 AA,
 * the same rule set the specialist optimization audit's accessibility lens
 * (§3) called for. See ADR 20260801-axe-core-playwright-a11y-scans. A
 * violation here means a real, tool-detectable defect (missing label, bad
 * contrast, broken landmark structure) — triage it into a fix rather than
 * excluding the rule, unless it's a genuine false positive (document why
 * inline if so).
 *
 * **`color-contrast` is on**, as of 2026-08-23. It was excluded app-wide for
 * three weeks on the belief that turning it on "would just paint CI red" over
 * design-token values a product decision had deliberately frozen. Measured,
 * that was not what it found: 23 failing nodes in light mode and one in dark,
 * reducing to four colour combinations, and every one of them was the same
 * mechanism rather than a frozen token — a translucent `bg-<hue>/10` fill
 * composited over something that is not `--surface`, which is the only
 * background the palette's ratios were ever computed against. A status pill on
 * the page background instead of a card lost 0.65:1; one nested inside a
 * tinted row lost 0.58 more. The fix was an opaque `--<hue>-tint` token
 * (`src/app/globals.css`), and the frozen `--success`/`--warning` values were
 * not touched (issue #793).
 *
 * So there is no exclusion list here, and there should not need to be one: a
 * new contrast failure on any surface this file scans is now a red build.
 */
export async function expectNoA11yViolations(page: Page) {
  // **From the top of the page, always** — a scan has to have a scroll
  // position, and "wherever the previous step left it" is not one.
  //
  // Two of the rules here read geometry rather than markup. `target-size`
  // measures how much of a control is reachable, and `color-contrast` reads
  // the colours on screen, so both answer differently about an element that is
  // sliding under a sticky header. The header is `position: sticky`, so on any
  // page scanned at an arbitrary offset *something* is partly behind it —
  // which is not a defect a reader meets, because the reader can scroll.
  //
  // That is not theoretical: the cert-gated roster below reaches its departure
  // by clicking a row on the board, and it used to inherit the board's scroll.
  // Axe then measured the `‹ BOARD` back-link at "63.7px by 9.5px" and failed
  // WCAG 2.5.8 — red on some CI runs and green on others, with byte-identical
  // numbers every time it was red (issue #1941). The landing itself is fixed,
  // in `src/app/globals.css`; this is the rule that stops the *next* scan
  // inheriting a position from a click three statements earlier.
  //
  // No rule is excluded and `target-size` stays on. Axe reads the whole
  // document rather than the viewport, so scanning from the top costs nothing
  // a scan at an offset would have caught — it only stops the two geometric
  // rules answering about the header instead of the markup.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  // A dynamic route with no build-time param coverage (a just-created trip,
  // never visited before) computes its <title> from a DB read inside
  // generateMetadata — under cacheComponents' Partial Prerendering, that
  // resolves on the same postponed-content channel as the page body, but not
  // always in lockstep with it: a scan that fires the instant the body's own
  // heading becomes visible can still catch a document with no <title> yet,
  // even though the page settles correctly moments later. Waiting for a
  // non-empty title scans the settled document instead of a genuinely
  // transient in-between state — this is not a real a11y defect a visitor
  // ever perceives, just the render finishing.
  //
  // **There used to be a `waitForLoadState("networkidle")` above this line, and
  // removing it is what un-redded `main` on 2026-08-21.** It was here to settle
  // the document before axe read it, with a `diveday:allow-e2e-hygiene`
  // exemption arguing there was no single element to wait for. There is: every
  // caller already gates on the surface's own heading before it scans, which is
  // the deterministic wait, and this is the gate that follows it.
  //
  // What that exemption cost: on CI runs 32439332010, 32440808953 and
  // 32441820119 the booking scan consumed its entire budget and died on that
  // line — at 30s, then 60s, then 120s, exactly the budget each time. A slow
  // test passes at *some* budget; this one never would, because `/ready` does
  // not reach network idle on a CI runner at all (it settles in ~0.5s locally,
  // so it never reproduced here). The failure read as a hang in
  // `waitForLoadState` and was twice misdiagnosed as cost, which is precisely
  // the "deterministic failure converted into an intermittent one" that
  // `check:e2e-hygiene` refuses this API for.
  //
  // **What was in flight, from the trace of run 32441820119: nothing.** The
  // page's last network event was the shop-location Google Maps iframe on
  // `/ready` (`TripArrivalCard`, src/components/TripArrivalCard.tsx; it sat in
  // a trailing `ShopCard` on the page itself until 2026-09-17) — `GET
  // https://maps.google.com/maps?…&output=embed`, which *this suite's own*
  // `context.route` abort in e2e/fixtures.ts failed 137ms before the wait even
  // started, leaving that child frame committed on `chrome-error://chromewebdata/`.
  // For the remaining 112 seconds the page requested nothing at all. So the
  // page is not retrying, polling, or holding a connection open: `/api/vitals`
  // only beacons on `visibilitychange`/`pagehide`, CloudWatch RUM never loads
  // its SDK without `NEXT_PUBLIC_RUM_*` (unset fleet-wide), and the add-to-
  // calendar Route Handler is a bare `<a>` that `next/link` never prefetches.
  // What never arrived was Playwright's frame-tree `networkidle` lifecycle
  // event, which only fires once **every** child frame reports idle — and that
  // aborted map frame is the page's only one. It does not wedge on macOS
  // (measured at 523ms against a warm e2e server), so the Linux-runner half of
  // that is unproven; the useful half is that the culprit is a third-party
  // iframe this harness deliberately killed (it answers it with an empty page
  // now, pixel-craft K-511), not anything a diver's phone does. Which is the
  // whole argument for waiting on content instead.
  //
  // **Order still matters.** The title assertion is last, immediately before
  // `analyze()`, so the document axe reads is the one this checked. Asserting it
  // *first* let it pass against the document the caller was already looking at
  // while the scan then ran on a newly swapped-in one — how the add-a-booking
  // scan went red on CI run 30887575971 with `document-title`.
  await expect(page).toHaveTitle(/.+/);
  // **And a settled *paint*, not just a settled document.** `color-contrast`
  // reads the colours that are on screen at the instant it runs, so an element
  // partway through an entrance animation is measured at whatever opacity it
  // had reached: the schedule builder's inline row menu, which fades in over
  // 200ms, reported its Remove control at 2.12:1 — a real number about a state
  // no one reads, since a beat later it is 5.45:1.
  //
  // This waits on the animations themselves rather than on a duration, so it
  // is exact and cannot be a timing guess. Infinite ones are skipped
  // deliberately: `animate-pulse` skeletons and spinners never finish, and
  // waiting on one would hang the scan rather than settle it.
  //
  // **So is anything the renderer is not drawing.** An animation on an element
  // inside a skipped subtree — the body of a closed `<details>`, which
  // `globals.css` holds at `content-visibility: hidden` — is never ticked to
  // its end, so its `finished` promise stays pending for the life of the page
  // even once its play state reads "finished". Measured on the settings hub
  // the day its rows started landing closed (CI run 35203133939, and 1 in 4
  // locally under load): the Online-payments row's `rise-in` warning callout,
  // 200ms long, held this scan for the whole 85s budget. `color-contrast`
  // never reads an unrendered element either, so nothing is traded away by
  // not waiting on it. `checkVisibility()` is the one call that answers
  // "would this be painted" for a skipped subtree as well as for
  // `display: none`.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => {
          if (animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY) {
            return false;
          }
          // A scroll-driven animation (the table shell's edge fade,
          // `animation-timeline: scroll(self inline)`) is positioned by a
          // scroll offset, not a clock: its `finished` never settles, so
          // waiting on it held every scan of a page with a `Table` until the
          // test timed out. visual.spec.ts's settle skips it the same way.
          if (animation.timeline !== document.timeline) return false;
          const target =
            animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          return !(target instanceof Element) || target.checkVisibility();
        })
        .map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
  // `document-title` is disabled because the settle-then-gate ordering above
  // did not fully close its race: it recurred on CI run 31112513322 (2026-08-06,
  // main, this file's add-a-booking door test) *after* that fix. Mechanism:
  // when a scan follows a same-route transition (a server action's redirect
  // back with `?notice=`), the old document's title is non-empty and textually
  // identical to the new one, so `toHaveTitle` passes against it — and React's
  // streamed-metadata swap then removes the old <title> a beat before
  // inserting the new one, leaving a transient empty window nothing page-side
  // can wait out (no content can prove "no further metadata swap is coming").
  // The guarantee the rule checks is not lost: the `toHaveTitle` gate above
  // asserts a non-empty title on the settled document, deterministically, for
  // every scanned surface. What axe would add is only catching the framework's
  // own transient — not a defect any visitor perceives.
  // **No two elements share a DOM id.** Not an axe rule — `duplicate-id` and
  // `duplicate-id-active` were removed from axe-core in 4.9, and the surviving
  // `duplicate-id-aria` only fires when an ARIA attribute points at the
  // duplicate — so the shape that actually hurts here is invisible to the scan
  // above: two `Field`s (src/components/ui/form.tsx) minting the same
  // `useId()`, whose `<label for>` then resolves to whichever element the
  // document happens to reach first and whose accessible name computes as
  // *both* labels concatenated. The DOM looks correct in a diff, in a
  // screenshot, and to every assertion this suite already makes; what is wrong
  // is only the name a screen reader speaks.
  //
  // Issue #1022 reported exactly that, theorising a `cacheComponents`/`useId`
  // interaction — which is right: PPR resumes a prerendered shell beside
  // streamed dynamic content, two passes, each starting the server `useId`
  // counter at 1. It only shows up on a **client-side navigation**, so a hard
  // load of the same URL is clean and a sweep of 229 hard-loaded renders found
  // nothing. `scopedFieldId` (src/components/ui/form.tsx) separates the pairs
  // those two counters can produce; this is the net under that fix, and the
  // reason nobody noticed for as long as they didn't is that no test could see
  // it. Now 38 scanned surfaces can — including the ones these scans reach by
  // clicking rather than by `goto`.
  const duplicateIds = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) {
      seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    }
    return [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => {
        const labelled = [...document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)]
          .map((label) => label.textContent?.trim() ?? "")
          .filter(Boolean);
        return { id, count, labels: labelled };
      });
  });
  expect(duplicateIds, JSON.stringify(duplicateIds, null, 2)).toEqual([]);

  // **Scan the settled page, not a frame of an entrance.** A `rise-in` banner
  // is mid-fade for its first 200ms, and axe measures the blended ink: the
  // cert-gate refusal read #bc4249 on #fae8e9 (4.43:1) on its way to the
  // token's own pair. Neither awaiting each animation's `finished` (it hung on
  // animations that never settle) nor calling `finish()` (a banner React
  // remounts after the call starts its entrance again) holds, so the scan
  // reads the page as a reduced-motion reader sees it: globals.css's
  // kill-switch lands every entrance on its last frame, whenever it mounts.
  const reducedAlready = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .disableRules(["document-title"])
    .analyze();
  // A describe that asked for reduced motion keeps it; everyone else gets motion back.
  if (!reducedAlready) await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}
