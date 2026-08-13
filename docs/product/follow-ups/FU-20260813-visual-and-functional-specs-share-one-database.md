# FU-20260813-visual-and-functional-specs-share-one-database — Make the e2e suite survive being run as one suite, or say plainly that it cannot be

- **Status:** Open
- **Raised:** 2026-08-13 — PR #501, branch `claude/dive-booking-ui-refinements-t5eoy6`. Found by
  running the whole Playwright suite in one process before pushing, which is not what CI does and
  not what any `package.json` script does.
- **Kind:** risk
- **Effort:** M
- **Touches:** `e2e/visual.spec.ts`, `e2e/marketing.spec.ts`, `e2e/servers.ts`,
  `playwright.config.ts`, `.github/workflows/ci.yml`, `src/db/seed-backup.ts`,
  `package.json`

## What I noticed

`pnpm e2e:run --workers=2` with no spec filter — every functional spec and every visual capture in
one process against one database — fails three tests that all pass on their own:

- `e2e/visual.spec.ts:2324` "the data-export page renders true to the design", both light and dark.
  It waits for `getByRole("cell", { name: "Failed" })` and gets a **strict-mode violation: two
  matching cells**. The seed ships blue-mantis with six weekly deliveries and exactly one failed
  week (the capture's own docblock says so), so a second "Failed" row is somebody else's write
  landing in the delivery ledger while the capture is reading it.
- `e2e/marketing.spec.ts:330` "migration guides walk a shop from an incumbent export into the
  importer" — a bare 15s timeout with no locator named in the failure.

CI never sees this. `.github/workflows/ci.yml` runs `e2e/visual.spec.ts --shard=N/4` in four
"Visual capture" jobs and the functional specs in four separate "Playwright shard" jobs, so a
capture and a functional spec never share a database concurrently. All eight shards were green on
the commit where the local combined run failed.

So this is not a broken product and not a broken test. It is a **suite-level assumption nobody
wrote down**: that visual captures get a database no functional spec is concurrently mutating.
The assumption holds today only because of how the CI workflow happens to be sharded.

## Why it isn't already done

Out of scope for the PR that found it, and a real design question rather than a bug with an obvious
patch.

It also is not urgent in the way a red CI check is: nothing a shop uses is affected, and the
project's own documented commands (`pnpm e2e <spec>`, `pnpm e2e:run <spec>`) do not reproduce it.
The reason it is worth writing down anyway is that the failure mode is *confusing rather than
loud*: a future session that runs the full suite locally to be thorough — exactly the diligent
thing to do — gets three red tests that do not reproduce in isolation, and has to spend the time I
spent working out whether they are real. Worse, it trains the habit of shrugging at a red suite.

What I would not do: add `test.describe.configure({ mode: "serial" })` or drop the visual spec's
worker count. That trades wall-clock on the CI path (which is fine today) to fix a path CI does not
run, and it hides the shared-state coupling instead of naming it.

## Proposed change

Pick one of these two, deliberately. They are both defensible; what is not defensible is leaving
the assumption implicit.

1. **Say the suite is sharded by design, and make the combined run refuse.** Cheapest and most
   honest. `playwright.config.ts` gains a guard: if the run includes both `visual.spec.ts` and any
   functional spec, fail immediately with a message naming the two commands to use instead. A
   contributor gets a sentence rather than a mystery. Add the same sentence to the
   **e2e-and-visual** skill and the `pnpm e2e` row in AGENTS.md's command table.
2. **Make the captures independent of shared mutable rows.** More work, more durable. The
   data-export capture's dependency is the sharpest example: it asserts on a *count-sensitive*
   locator over a ledger any other spec can append to. Give the backup-export delivery history its
   own seeded shop (or scope the capture to a shop no functional spec touches), so the row it
   photographs cannot be perturbed. Then audit the other captures for the same shape — a capture
   that waits on a locator whose cardinality depends on rows another spec can write.

Whichever is chosen, `e2e/marketing.spec.ts:330` needs diagnosing on its own first: it timed out
with no locator named, so it may be a different problem wearing the same clothes (a slow
`/switching/*` render under two workers rather than shared-row contention). Do not assume one
cause for all three.

## Prompt

```text
The DiveDay Playwright suite passes shard-by-shard on CI but fails three tests when the whole
suite is run in one process against one database. Decide whether that combined run should be
supported or refused, and implement the answer.

Reproduce first:
  pnpm e2e:build
  pnpm e2e:run --reporter=line --workers=2
Expect ~557 passed and 3 failed: e2e/visual.spec.ts:2324 (data-export capture, light and dark)
and e2e/marketing.spec.ts:330. Each passes when run alone.

Read first:
  - docs/product/follow-ups/FU-20260813-visual-and-functional-specs-share-one-database.md
    (this file; its "Proposed change" section gives two options and argues against a third)
  - .github/workflows/ci.yml — note that visual captures and functional specs run in SEPARATE
    jobs, which is the only reason CI is green
  - the data-export capture in e2e/visual.spec.ts and its docblock, which states the seed ships
    exactly one failed delivery week
  - src/db/seed-backup.ts
  - the e2e-and-visual and debug skills

The constraint that makes this non-obvious: the failing assertion is a strict-mode violation from
TWO "Failed" cells where the seed provides one. That is shared mutable state (the backup-export
delivery ledger), not a timing flake — so widening a timeout or serialising the suite would hide
it rather than fix it. Do not reach for test.describe.configure({ mode: "serial" }).

Diagnose e2e/marketing.spec.ts:330 separately before assuming it shares a cause; it timed out
without naming a locator.

Done means: running the full suite in one process either passes, or fails immediately with a
message naming the supported commands — and whichever you chose is written down in AGENTS.md's
command table and the e2e-and-visual skill, so the next person does not rediscover it.

Run: pnpm check, then the full combined run above, then a single sharded run
(pnpm e2e:run e2e/visual.spec.ts --reporter=line) to confirm you did not break the CI path.

Delete docs/product/follow-ups/FU-20260813-visual-and-functional-specs-share-one-database.md as
part of the change.
```
