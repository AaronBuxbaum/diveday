# 20260721-argos-visual-regression — Argos visual regression on six key surfaces

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

Nothing in CI looks at rendered pixels. `pnpm check` asserts semantics (types, lint, unit
behavior) and the Playwright suite asserts wiring by role and text — a semantic-token violation,
a dark-mode contrast regression, or a misaligned form passes every gate. The repo's guard against
this is the "look at UI you changed" hard rule in AGENTS.md, which is manual and self-policed; the
developers are AI agents, and DiveDay's stated competitive position is experience, not features.

The prerequisites for stable screenshot diffing already exist: the e2e fleet is deterministic
(seeded in-memory PGlite per worker, external HTTP disabled), and the seed was written to look
right in screenshots (departure times round to half-hour slots). The remaining variability is the
clock-anchored seed itself — dates and times move with the wall clock.

## Decision

Add [Argos](https://argos-ci.com) visual regression via `@argos-ci/playwright` (dev dependency):

- `e2e/visual.spec.ts` captures six key surfaces — landing, public schedule, course page, Today,
  trip manage, boat manifest — in light and dark at one desktop viewport: **12 screenshots per
  run**, sized to stay inside Argos's free tier (~5,000/month) at ~10 pushes/day.
- Clock-derived text (times, dates) is masked so the moving seed cannot produce spurious diffs;
  layout, spacing, and color remain fully asserted.
- The Argos reporter in `playwright.config.ts` uploads only when `ARGOS_TOKEN` is set (a GitHub
  Actions secret). Without it — local runs, forks, before the Argos project exists — capture
  still happens and the reporter is a no-op, so the suite never depends on the service to pass.
- Argos compares each PR's screenshots against the base branch and posts an approve-the-diff
  check on the PR.

## Alternatives considered

- **Playwright's built-in `toHaveScreenshot()`** — free and unlimited, baselines committed to
  git, GitHub's image diff as the review UI. Rejected in favor of Argos's hosted baseline
  management and explicit approval workflow, which fits agent-driven development (a human
  approves visual changes; agents cannot silently update a baseline in the same commit that
  regressed it). Remains the fallback if Argos quota or cost ever becomes a problem — the spec
  and masking transfer directly.
- **Percy (BrowserStack)** — snapshot quota multiplies across rendered browsers/widths and the
  first paid tier is ~$199/month; poorest fit for a cost-sensitive repo.
- **Chromatic** — Storybook-first; this repo has no Storybook, and its paid tier is similarly
  expensive.
- **Full matrix (both viewports)** — 24 screenshots/run overshoots the free tier at the expected
  push rate. Phone-viewport coverage can be added to specific surfaces later if a paid plan is
  ever justified.

## Consequences

- New dev dependency `@argos-ci/playwright`; screenshots ride the existing e2e job, adding a few
  seconds per run.
- Activation requires a one-time manual step: create the Argos project (GitHub sign-in at
  argos-ci.com, import the repo) and add `ARGOS_TOKEN` to the repository's Actions secrets. Until
  then the integration is dormant and CI is unaffected.
- Visual changes to the six covered surfaces now require an explicit approval in Argos once the
  token is live; agents making intentional UI changes should note this in the PR so the reviewer
  approves the diff alongside the code.
- The masked regions (time/date text) are excluded from visual assertions on those surfaces —
  regressions purely inside masked text (e.g. a wrong time format) still rely on the text-level
  e2e assertions that already cover them.
