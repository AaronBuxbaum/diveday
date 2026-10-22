# E2E and visual: determinism and the renderer wedge

Part of the **e2e-and-visual** skill ([SKILL.md](SKILL.md)). Read it before writing any wait, animation, clock or font-dependent assertion, and when a spec hangs inside the browser.

## Determinism

The tests run a production Next server backed by in-memory PGlite. The browser context fixture in `e2e/fixtures.ts` resets `/api/test/reset` and freezes the browser clock to the same `DIVEDAY_CLOCK` used by the server, answers Google Maps with an empty page (the map frame renders blank; see the K-511 comment in `e2e/fixtures.ts`), and handles color schemes. Before every screenshot, `capture()` runs `paintWholeDocument()` (scrolls the page through so Chromium rasterizes every band — a `fullPage` shot of a tall page can otherwise come back with unpainted bands below the fold) and waits for `document.fonts.ready`. That does not by itself wait for a route's content: `page.goto` resolves on the streamed shell, so a route with a `loading.tsx` can still get photographed mid-skeleton — and since ADR 20260804-instant-navigation **every** route has one, so this is no longer a hazard on only a handful of surfaces. **Every capture site must wait for something the real content renders** — a heading, a known element, or for a Client Component, a control it only renders once mounted — before calling `capture()`; a capture that navigates and shoots immediately is a bug even if it happens to pass once. Watch for a wait that the *previous* page also satisfies: after a client-side click, an eyebrow or nav label shared by both pages resolves instantly against the old DOM and shoots the new route's skeleton (see the `order-detail` capture, which waits on "Back to diver" for exactly this reason).

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead. If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use `DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

## The renderer wedge: every renderer-dependent wait is driver-bounded

Chromium's renderer occasionally stops answering entirely on CI — not slow, *gone*: it won't
return even a trivial `page.evaluate(() => true)`. It is non-deterministic, unattributed after
multiple investigations (fa51f893, the 20260804 bound, run 31147282309), strikes arbitrary pages
(the landing page inside the first capture's first wait, `/pricing`, a diver record), and
vanishes on same-commit reruns. Treat it as browser infrastructure, not something to root-cause
in app or spec code — the probe verdict "wedged, not slow" in the log *is* the diagnosis.

The harness discipline that contains it, which any new capture code must keep:

- **No renderer-dependent call may rely on Playwright's own timeouts.** Page-side bounds
  (`setTimeout`, `requestAnimationFrame` races) cannot fire in a renderer that stopped running
  the page, and `page.evaluate` has no timeout of its own. Worse, `page.screenshot`'s `timeout:`
  option bounds only the preparation, not the protocol call — measured on run 31147282309, a
  screenshot with `timeout: 15_000` hung 95+ seconds until the test's own ceiling killed it. So
  every such call goes through a driver-side `Promise.race` bound: `withRendererBound` for
  evaluates, `screenshotOrGiveUp` for screenshots. A new screenshot call site in
  `e2e/visual-*.spec.ts` must use `screenshotOrGiveUp`, never bare `page.screenshot`.
- **On a stall, probe before blaming.** Both helpers ask the page `evaluate(() => true)` with a
  5s bound and word their message by the answer: alive means our wait leaked (investigate);
  "wedged, not slow" means the known wedge.
- **A functional spec has no bound of its own, so its failure says it.** `browserActivity`
  (`e2e/fixtures.ts`) probes a *failed* test's page once, and a page that never answers puts
  `renderer: no answer to evaluate(() => true) in 5000ms — wedged, not slow` first in the
  attachment the CI log prints. A click stuck on "waiting for element to be visible, enabled and
  stable" with no line after it, a failure screenshot that never arrives, and that verdict are the
  wedge (certifications.spec.ts, run 38783640609); the same click with an answering page is yours.
- **The literal phrase `wedged, not slow` is load-bearing.** ci.yml's visual job and the
  functional `Playwright shard` step (#2633) grep their logs for it: a failed step carrying that
  verdict gets exactly one `--last-failed` rerun, because a proven-wedged browser is the one failure a rerun cannot mask.
  Any failure without the verdict stays red on the first attempt — this is not a retry policy,
  and `retries: 0` remains the suite's contract. Reword the phrase and the gate silently dies.
- **Why containment matters this much:** one wedged capture fails its shard, a failed shard
  uploads no screenshots, `visual-report` then compares nothing — and on main publishes no
  baseline, blinding visual regression repo-wide until a human re-runs the shard.
