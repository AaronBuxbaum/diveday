---
name: e2e-and-visual
description: Write and maintain Playwright functional E2E tests and Playwright visual-regression captures that stay stable and complete. Use when adding or changing a user-facing flow or surface, when a visual diff appears, or when deciding what needs an E2E spec or visual scenario.
---

# E2E flows and visual regression

Every important user flow gets a functional Playwright spec under `e2e/`. Every important user surface gets a visual screenshot in `e2e/visual.spec.ts` using `page.screenshot()`. Diffs and reference comparisons are handled by `reg-suit` against baselines stored in S3. Keep the two concerns separate: functional specs prove behavior; visual specs capture rendered surfaces.

## Visual workflow

1. Add or update the screenshot capture in `e2e/visual.spec.ts`.
2. Reuse existing setup fixtures such as `signedInAsOwner()`, `/api/test/reset`, and page interactions exactly as a user would.
3. Run the visual suite locally to generate screenshots and compare:
   ```bash
   pnpm visual
   ```
4. If there are diffs, `reg-suit` will compare against the reference commit images on S3 and output an HTML report link. Open the link to review reference, actual, and diff images.

The normal matrix is light/dark × phone/desktop (390x844 and 1280x800) using the `capture()` helper. Print surfaces use the `capturePrint()` helper.

## Determinism

The tests run a production Next server backed by in-memory PGlite. The browser context fixture in `e2e/fixtures.ts` resets `/api/test/reset` and freezes the browser clock to the same `DIVEDAY_CLOCK` used by the server, aborts Google Maps, and handles color schemes. The `capture()` helper waits for `document.fonts.ready` before taking a screenshot.

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead. If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use `DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server and abort browser-only Google Maps requests.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and manifest/roll call) explicit.

## Definition of done

- New/changed behavior has a Playwright flow spec or an explicit reason not to add one.
- New/changed important surfaces have screenshot captures in `e2e/visual.spec.ts` and both schemes where applicable.
- `pnpm visual` runs successfully, and any visual differences are expected and reviewed in the reg-suit HTML report.
- `pnpm check` passes; run `pnpm e2e` when functional flows changed.
