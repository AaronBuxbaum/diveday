---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "scripts/route-coverage.json"
---

# Rules for `e2e/`

Loaded when a spec, fixture or the coverage ledger is read. The **e2e-and-visual** and
**visual-triage** skills are the procedures; the **debug** skill covers a red run.

- **Focused runs only, locally.** `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after
  one `pnpm e2e:build`. The whole suite belongs to CI, and `scripts/guard-bash.mjs` refuses the
  bare form ([docs/agents/verifying.md](../../docs/agents/verifying.md)).
- **Every worker owns a server and a database**, and `/api/test/reset` restores the shared
  `blue-mantis` fixture's **schedule** before each test — but not the shop's **configuration**
  (the `RESET_KEEPS` list in `src/db/delete-path-coverage.test.ts`). **A test that writes shop-wide
  settings takes a shop of its own**: the lazy `privateShop` fixture in `e2e/fixtures.ts` (ADR
  20260815-per-test-private-shops). Never a `finally` that puts the setting back — nothing enforces
  it and it does not survive the failure it is there for. Each invocation derives a per-worktree
  base port; `E2E_BASE_PORT` overrides it.
- **No timing guesses.** `waitForTimeout`, `networkidle`, spec-level `retries:` and hand-rolled retry
  loops are refused by `pnpm check:e2e-hygiene` unless the line carries
  `diveday:allow-e2e-hygiene <rule>: <why>` naming the mechanism that makes it deterministic. The
  suite runs `retries: 0` so a flake fails loudly and gets root-caused; the fix for a race is always
  waiting for what the destination page itself renders.
- **Never navigate straight off a submit.** A `goto`/`reload` as the next statement after a
  submit-shaped click races the action it just sent, and `check:e2e-hygiene`'s `action-race` rule
  refuses it: the click resolves when the request leaves, not when the write lands, so the
  navigation can tear the page down mid-flight and the destination renders the state from before
  the save. Put the wait between them — `page.waitForURL()` on the action's own `?notice=`
  redirect, or an `expect(locator)` on what the row shows for a `useActionState` form that
  re-renders in place. **Reading the field back is not a wait**: an `expect(field).toHaveValue(…)`
  or `.toBeChecked()` naming what this same test typed passes on its first poll whether or not the
  write landed, so the rule steps straight over it — assert the round trip after a real wait, never
  as one. Both instances that reached CI failed dozens of lines away from the cause
  ([docs/agents/repo-checks.md](../../docs/agents/repo-checks.md)).
- **An absence assertion pairs with a positive query.** A locator naming a string nothing renders
  any more satisfies `.toHaveCount(0)` for the wrong reason, so keep the same string queried
  positively somewhere in the spec — that pairing is the only thing that proves the name still
  matches anything. It is a convention, not a guard: the rule was written and swept, and it flags
  98 lines across 46 of the 112 files here, so it is not live (#1403, counts in
  [docs/agents/repo-checks.md](../../docs/agents/repo-checks.md)).
- **A failing or flaky test is part of the work, even when unrelated to your change.** Never skip
  it, widen a timeout, or leave it red. Search open PRs first for a fix already in flight on the same
  spec.
- **Screenshots are full-size and unfiltered; bound the *page*, not the capture.** A surface that
  screenshots enormous is telling you the page is unbounded, and the fix is pagination (or a default
  range) in the product — never a `?filter=` in the spec that shrinks the picture. Narrowing a
  capture to make it cheap silently narrows what it can catch; the orders index was found this way:
  323 seeded orders, no pager, no baseline at all.
- **A panel that only renders when something has gone wrong** is photographed through
  `/api/test/seed-trouble-states`, never by seeding the failure into the demo shop. Add the state to
  `src/app/api/test/seed-trouble-states/route.ts` and a capture beside the surface's calm one.
- **Route coverage**: every `src/app/**/page.tsx` route is listed in `scripts/route-coverage.json`
  with the specs and `e2e/visual.spec.ts` captures that cover it, or a written `exempt` reason. The
  lists are hand-maintained (a spec usually *clicks* its way to a route); `--write` rewrites only
  mechanical facts, `--absorb` records a merge-in loss, `--report` prints the table. The `a11y`
  column is what `pnpm agent:health` reads for the axe share.
- **Fixtures**: prefer `staffContext.newPage()` and the exported fixtures; `pnpm check:e2e-fixtures`
  flags a hand-built context.
- **The clock is frozen at the harness boundary** (`TEST_FROZEN_CLOCK`); never stabilise a capture
  by masking moving text.
- **Visual diffs**: baselines live in S3 keyed by git commit (ADR
  20260729-reg-suit-visual-regression) — nothing to regenerate locally. "Approving" an intentional
  change means saying in the PR *why* the pixels moved and merging. Baselines are rendered on CI's
  Linux runners; on macOS nearly everything reads as changed — triage from the CI report.
- **Every important flow gets a spec, every important surface a capture** — if unsure whether
  something qualifies, it does.
