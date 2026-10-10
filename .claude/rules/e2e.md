---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "scripts/route-coverage.json"
---

# Rules for `e2e/`

The **e2e-and-visual** and **visual-triage** skills are the procedures; the **debug** skill covers a
red run. Each rule names what enforces it; the reasoning and the incidents are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-e2e-rules).

- **Focused runs only, locally**: `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after
  `pnpm e2e:build`; `scripts/guard-bash.mjs` refuses the bare form.
- **A test that writes shop-wide settings takes `privateShop`** (`e2e/fixtures.ts`), never a
  `finally` that puts the setting back; `/api/test/reset` restores the schedule, not the
  configuration (`RESET_KEEPS` in `src/db/delete-path-coverage.test.ts`; ADR
  20260815-per-test-private-shops).
- **No timing guesses**: `waitForTimeout`, `networkidle`, spec-level `retries:` and retry loops fail
  `pnpm check:e2e-hygiene` unless the line says `diveday:allow-e2e-hygiene <rule>: <why>`. The suite
  runs `retries: 0`.
- **Never navigate straight off a submit**: wait on the action's `?notice=` redirect or on what the
  row shows; reading the field back is not a wait (`check:e2e-hygiene`, `action-race`).
- **An absence assertion pairs with a positive query** of the same string elsewhere in the spec.
  A convention, not a guard (#1403).
- **A failing or flaky test is part of the work**, even when unrelated; search open PRs for a fix
  in flight first.
- **A test's budget is one call with its measured reason**: `test.slow()` or `test.setTimeout()`,
  never both (the later one replaces the first). Each CI shard's summary lists the tests over half
  their own budget (`scripts/e2e-budget-report.mjs`, #1906).
- **Bound the page, not the capture**: a huge screenshot means the page needs a pager, never a
  `?filter=` in the spec.
- **A trouble state is photographed through `src/app/api/test/seed-trouble-states/route.ts`**,
  never seeded into the demo shop.
- **Every route is in `scripts/route-coverage.json`** with its specs and captures, or a written
  `exempt` reason: `pnpm check:route-coverage`.
- **Fixtures**: `staffContext.newPage()` and the exported fixtures (`pnpm check:e2e-fixtures`).
- **The clock is frozen at the harness** (`TEST_FROZEN_CLOCK`); never mask moving text.
- **Visual baselines live in S3 by commit**, rendered on CI's Linux runners (ADR
  20260729-reg-suit-visual-regression); approving a change is saying in the PR why the pixels moved.
- **Every important flow gets a spec and every important surface a capture**; if unsure, it does.
