# 20260721-argos-visual-regression — Argos visual regression on ten key surfaces, phone + desktop

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

- `e2e/visual.spec.ts` captures ten key surfaces — landing, sign-in, public schedule, the public
  reef briefing, course page, Today, the divers roster, a diver profile, trip manage, and boat
  manifest — in light and dark at **both** a phone (390) and a desktop (1280) viewport, matching the
  widths in `scripts/screenshot.mjs`: **40 screenshots per run**. Both viewports come from one
  `argosScreenshot` call via its `viewports` option, which suffixes each name with ` vw-<width>`.
- Clock-derived text (times, month-name dates, and numeric `M/D/YYYY` dates such as cert expiry) is
  masked so the moving seed cannot produce spurious diffs; layout, spacing, and color remain fully
  asserted.
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
- **Single desktop viewport** — the original decision (12 screenshots/run) kept the footprint
  minimal but never looked at the phone layout, where DiveDay's dock-side and diver-facing surfaces
  actually get used. Reversed here: experience is the product, and mobile is where much of it is
  lived, so both viewports are worth the screenshot budget.

## Consequences

- New dev dependency `@argos-ci/playwright`; screenshots ride the existing e2e job, adding a few
  seconds per run.
- At 40 screenshots/run the free ~5,000/month tier comfortably covers ~4 pushes/day; a busier
  cadence than that is the point at which trimming surfaces, dropping to one viewport, or moving to
  a paid tier becomes the lever. The `viewports`-suffixed names (` vw-390` / ` vw-1280`) mean the
  first run after this change re-establishes every baseline for a human to approve.
- Activation requires a one-time manual step: create the Argos project (GitHub sign-in at
  argos-ci.com, import the repo) and add `ARGOS_TOKEN` to the repository's Actions secrets. Until
  then the integration is dormant and CI is unaffected.
- Visual changes to the ten covered surfaces now require an explicit approval in Argos once the
  token is live; agents making intentional UI changes should note this in the PR so the reviewer
  approves the diff alongside the code.
- The masked regions (time/date text) are excluded from visual assertions on those surfaces —
  regressions purely inside masked text (e.g. a wrong time format) still rely on the text-level
  e2e assertions that already cover them.
