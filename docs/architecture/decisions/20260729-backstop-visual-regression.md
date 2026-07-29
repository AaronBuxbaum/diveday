# 20260729-backstop-visual-regression — Use BackstopJS for visual regression

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

DiveDay's visual coverage had grown to 158 Playwright screenshot assertions across public,
staff, authenticated-token, offline, and print surfaces. The suite needed a dedicated visual
workflow with an HTML reference/test/diff report and explicit approval, while keeping the frozen
clock, deterministic PGlite reset, real authentication, and light/dark, phone/desktop, and print
coverage intact. The existing CI job also committed regenerated baselines automatically, which
made an intentional visual change harder to review alongside the code that caused it.

## Decision

Use BackstopJS 6.3.25 with its Playwright engine for visual regression. The source of truth is
`backstop.config.cjs` plus the stateful journeys in `backstop/`; committed references live under
`backstop_data/bitmaps_reference/`, while test captures and HTML/CI reports are generated and
ignored. `scripts/backstop-run.mjs` builds and starts the deterministic E2E server, creates the
seeded owner session, and can run one Backstop scenario shard at a time. CI runs four shards in
parallel, each with its own server and in-memory PGlite database, so each scenario can still reset
state independently without forcing the entire suite through one runner.

Use these commands:

- `pnpm backstop:reference` to create or intentionally refresh references.
- `pnpm backstop` to compare captures with the committed references.
- `pnpm backstop:approve` only after reviewing the Backstop report for an intentional change.
- `pnpm backstop:report` to reopen the most recent local report.

Playwright remains the functional E2E runner; it no longer owns visual assertions or visual
baselines. Both systems share the frozen server clock, disabled third-party HTTP, and the same
Chromium installation path. Sentry telemetry and source-map upload are disabled only for E2E
builds so local and CI capture cannot disclose build data.

## Alternatives considered

- **Playwright `toHaveScreenshot()`** — reliable, but its assertion/baseline workflow did not
  provide the dedicated review and approval report we need.
- **Argos** — hosted service and external token would add an operational dependency for a suite
  that can remain self-managed.
- **reg-suit** — useful reporting, but adds another comparison/publishing layer without a better
  fit for the existing Playwright browser flows.
- **Percy** — hosted review and storage are valuable, but the service dependency and cost are not
  justified for this stage of DiveDay.

## Consequences

Backstop gives reviewers a local/CI HTML report with reference, test, and diff images, and an
intentional change is promoted explicitly with `approve`. Reference PNGs remain versioned, so the
repository still carries the visual contract and no hosted token is required. The scenario setup
code is separate from functional specs and must be kept in sync when a visual surface's route or
seeded state changes. We accept serial capture within each shard in exchange for isolated state and
stable review artifacts, while using CI-level sharding to keep wall-clock time closer to the
functional Playwright lane.

Revisit this decision if visual references outgrow practical repository storage or if the team
needs hosted cross-browser history and review. At that point, the Backstop scenario map and
deterministic hooks can feed a hosted comparator, while the functional Playwright suite remains.
