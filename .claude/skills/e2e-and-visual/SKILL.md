---
name: e2e-and-visual
description: Write and maintain Playwright functional E2E tests and Playwright visual-regression captures that stay stable and complete. Use when adding or changing a user-facing flow or surface, when a visual diff appears, or when deciding what needs an E2E spec or visual scenario.
---

# E2E flows and visual regression

Every important user flow gets a functional Playwright spec under `e2e/`. Every important user surface gets a visual screenshot, captured by a `test.describe(..., { tag: "@visual" })` block placed in whichever `e2e/*.spec.ts` file already reaches that surface, using `capture()`/`capturePrint()` from `e2e/visual-capture.ts` (see ADR 20260730-tag-based-visual-capture — this replaced a single dedicated `e2e/visual.spec.ts` file). Diffs and reference comparisons are handled by `reg-suit` against baselines stored in S3. Keep the two *concerns* separate even though they now share files: a `@visual`-tagged test still only captures, never asserts on behavior, and a functional test's own assertions never get mixed into a capture test's body — new capture tests are self-contained (they do their own navigation) rather than spliced into an existing functional test.

## Visual workflow

1. Find (or create) an `e2e/*.spec.ts` file that already reaches the surface you need a baseline for — usually the file testing the flow that renders it. Add a `test.describe(`${scheme} mode`, { tag: "@visual" }, () => { ... })` block looping `for (const scheme of ["light", "dark"] as const)`, matching the pattern already used throughout the suite.
2. Reuse existing setup fixtures such as `signedInAsOwner()`, `/api/test/reset`, and page interactions exactly as a user would.
3. Run just the visual captures locally to generate screenshots and compare:
   ```bash
   pnpm visual
   ```
   (This runs `playwright test --grep @visual` then `reg-suit run`.) To iterate on one capture, `playwright test <spec> --grep @visual`.
4. If there are diffs, `reg-suit` will compare against the reference commit images on S3. Run `pnpm visual:report` to pull the reference, actual, and diff PNGs down locally with a markdown summary — the printed HTML report link is a client-rendered SPA (an empty `<div id="app">` until JS runs) and isn't fetchable as a static page, so agents should use the script instead of trying to open that link. See the **visual-triage** skill.

The normal matrix is light/dark × phone/desktop (390x844 and 1280x800) using the `capture()` helper. Print surfaces use the `capturePrint()` helper, outside the light/dark loop (print is scheme-independent) with `test.use({ viewport: { width: 816, height: 1056 } })`.

CI note: the four `Playwright shard N/4` jobs run every spec file, `@visual`-tagged tests included, and each shard uploads `e2e/screenshots/` as an artifact. A separate `reg-suit visual regression` job downloads and merges all four shards' artifacts, then runs `reg-suit run` only — it does not run Playwright itself, so a capture that never ran in any shard (a typo'd `--grep`, a spec excluded from the matrix) simply never reaches the diff, silently. If a surface you expect to see baselined is missing from a reg-suit report, check that its test actually ran in one of the shard jobs before assuming the diff is clean.

## Determinism

The tests run a production Next server backed by in-memory PGlite. The browser context fixture in `e2e/fixtures.ts` resets `/api/test/reset` and freezes the browser clock to the same `DIVEDAY_CLOCK` used by the server, aborts Google Maps, and handles color schemes. Before every screenshot, `capture()` runs `paintWholeDocument()` (scrolls the page through so Chromium rasterizes every band — a `fullPage` shot of a tall page can otherwise come back with unpainted bands below the fold) and waits for `document.fonts.ready`. That does not by itself wait for a route's content: `page.goto` resolves on the streamed shell, so a route with a `loading.tsx` can still get photographed mid-skeleton. **Every capture site must wait for something the real content renders** — a heading, a known element, or for a Client Component, a control it only renders once mounted — before calling `capture()`; a capture that navigates and shoots immediately is a bug even if it happens to pass once.

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead. If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use `DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

A file that imports `test`/`expect` directly from `@playwright/test` instead of `e2e/fixtures.ts` (rare — check the file's own imports before adding a capture to it) does **not** get the frozen-clock context or per-worker `baseURL` routing. A `@visual` capture placed there would be pixel-unstable; import a separately-fixtured `test` from `e2e/fixtures.ts` for the capture block instead of reusing that file's own (see `e2e/calendar-sync.spec.ts` for the pattern), rather than switching the whole file's existing tests onto the fixtured `test` as a side effect.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server and abort browser-only Google Maps requests.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and manifest/roll call) explicit.

## Definition of done

- New/changed behavior has a Playwright flow spec or an explicit reason not to add one.
- New/changed important surfaces have `@visual`-tagged screenshot captures (in the spec file that already reaches them) for both schemes where applicable.
- `pnpm visual` runs successfully, and any visual differences are expected and reviewed via `pnpm visual:report` (or the reg-suit HTML report, for a human).
- `pnpm check` passes; run `pnpm e2e` when functional flows changed.
