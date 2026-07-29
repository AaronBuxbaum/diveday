---
name: e2e-and-visual
description: Write and maintain Playwright functional E2E tests and BackstopJS visual-regression scenarios that stay stable and complete. Use when adding or changing a user-facing flow or surface, when a visual diff appears, or when deciding what needs an E2E spec or visual scenario.
---

# E2E flows and visual regression

Every important user flow gets a functional Playwright spec under `e2e/`. Every important user
surface gets a Backstop scenario in `backstop.config.cjs`, with setup in `backstop/flows.cjs`.
Keep the two concerns separate: Playwright proves behavior; Backstop compares rendered surfaces.

## Visual workflow

1. Add or update the scenario in `backstop.config.cjs`.
2. Add its route/state setup to `backstop/flows.cjs`; do not duplicate a surface with a screenshot
   script. Stateful scenarios may use the seeded owner session, `/api/test/reset`, and real UI
   actions exactly as a user would.
3. Run a focused capture with `BACKSTOP_FILTER='scenario-label' node scripts/backstop-run.mjs test`
   or the corresponding `reference` command while iterating.
4. Open `backstop_data/html_report/index.html` with `pnpm backstop:report` and inspect reference,
   test, and diff images. Only after the change is understood, run `pnpm backstop:approve` and
   commit the resulting files under `backstop_data/bitmaps_reference/`.

The normal matrix is light/dark × phone/desktop (390×844 and 1280×800). The two dock print
scenarios use an 816×1056 viewport and print media. Keep that matrix unless the surface itself
requires a documented exception.

## Determinism

The Backstop wrapper runs a production Next server backed by in-memory PGlite. `onBefore.cjs`
resets `/api/test/reset` before every scenario/viewport, freezes the browser clock to the same
`DIVEDAY_CLOCK` used by the server, aborts Google Maps, applies the color scheme/media, and loads
the generated owner cookies for staff scenarios. `onReady.cjs` runs the stateful flow and waits
for `document.fonts.ready` before capture.

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead.
If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue
Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use
`DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests
  get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server and
  abort browser-only Google Maps requests.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle
  coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and
  manifest/roll call) explicit.

## Definition of done

- New/changed behavior has a Playwright flow spec or an explicit reason not to add one.
- New/changed important surfaces have a Backstop scenario and both schemes where applicable.
- `pnpm backstop` passes against committed references, and any intentional reference update is
  reviewed in the HTML report and committed explicitly.
- `pnpm check` passes; run `pnpm e2e` when functional flows changed.
