# 20260801-axe-core-playwright-a11y-scans — Automated axe scans in the e2e suite

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

The specialist optimization audit's accessibility lens (`docs/product/assessments/specialist-optimization-audit-20260731.md`
§3) found that `e2e/` asserts behavior almost entirely through accessible roles and names — good
practice, but nothing in the suite runs an automated accessibility scan, and only
`keyboard-shortcuts.spec.ts` asserts any focus behavior. A missing label or a failing contrast
ratio (like the focus-ring and status-banner issues the same audit found) ships silently; nothing
in CI would catch a regression like it again. Fixing that needs an automated scanner wired into
the existing Playwright fleet, not a new tool or process.

## Decision

Add `@axe-core/playwright` (`^4.12.1`) as a **devDependency only** — it drives `AxeBuilder` inside
Playwright tests and ships no code to the production bundle. `e2e/a11y.spec.ts` runs
`new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()` against zero
violations on five high-stakes surfaces: the public schedule, the trip booking page and its
confirmation, the waiver page (via a seeded bearer token), the staff manifest page, and
`/offline-manifest`. It runs in the existing sharded `playwright` CI job — no new job, no new
browser install, since it reuses the fleet's own Chromium headless shell (ADR
20260730-headless-shell-and-pinned-fallback-fonts).

Any violation the scanner finds gets triaged into a real fix (a label, a role, a contrast token —
several already tracked in the audit above) rather than a suppressed rule. A rule is excluded only
for a genuine false positive, and only with an inline comment explaining why.

## Alternatives considered

- **Lighthouse CI** — heavier (a full page-load audit, not a per-assertion scan), harder to target
  at specific interaction states (e.g. an open panel, a client-validation error), and mixes
  performance/SEO scoring into what this task needs as a pure a11y gate.
- **`eslint-plugin-jsx-a11y`** — static analysis catches some issues (missing `alt`, invalid ARIA)
  but nothing computed at runtime: contrast ratios, focus order, or `aria-live` announcements need
  a rendered page, which only a browser-driven scan provides.
- **Manual audits only** (what the specialist audit itself was) — valuable periodically, but exactly
  the "ships silently" gap this ADR closes: nothing runs it on every PR.

## Consequences

- **Makes easy:** catching an accessibility regression (missing label, bad contrast, broken
  landmark structure) on the same PR that introduced it, on the five surfaces the scan covers.
- **Makes hard / commits us to:** keeping those five surfaces genuinely violation-free — a page
  that regresses now fails CI rather than degrading quietly, so a future change touching one of
  them must fix what it breaks rather than deferring it.
- **Escape hatch:** the dependency is test-only and additive — removing it means deleting
  `e2e/a11y.spec.ts` and the package, with no production code path to unwind. If axe's ruleset ever
  proves too noisy for this codebase's patterns, narrow the `withTags` filter or the surface list
  before reaching for removal.
