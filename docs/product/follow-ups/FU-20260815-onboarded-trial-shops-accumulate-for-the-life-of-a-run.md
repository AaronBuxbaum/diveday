# FU-20260815-onboarded-trial-shops-accumulate-for-the-life-of-a-run — nine e2e specs onboard a real shop that nothing ever clears

- **Status:** Open
- **Raised:** 2026-08-15 — branch `fix/e2e-per-spec-shops`, while auditing every spec in `e2e/` for
  what it writes (ADR 20260815-per-test-private-shops). The shops these specs mint are *deliberately*
  outside the reset; what nobody decided is that they stay forever.
- **Kind:** risk
- **Effort:** M
- **Touches:** `e2e/onboard.spec.ts`, `e2e/first-ten-minutes.spec.ts`, `e2e/tenant-isolation.spec.ts`,
  `e2e/staff-nav.spec.ts`, `e2e/account-lifecycle.spec.ts`, `e2e/nitrox.spec.ts`, `e2e/demo.spec.ts`,
  `e2e/visual.spec.ts`, `src/app/api/test/reset/route.ts`, `src/db/seed-demo-lifecycle.ts`

## What I noticed

A spec that needs a *brand new* shop — what onboarding produces, before anything is seeded into it —
goes through `/onboard` and creates a real trial shop (`isDemo: false`, `src/app/onboard/actions.ts`).
That is correct: it is the only way to test what a shop starts with. But a trial shop is a **real**
shop, so nothing in the harness ever clears it. `resetDemoSchedule` is scoped to `blue-mantis`;
`purgeMintedDemoShops` takes only `isDemo` shops. The row, its owner, its login, and whatever the
spec then built inside it survive for the life of that worker's server.

Counted across a full run, that is around a dozen shops: `onboard.spec.ts` (3),
`first-ten-minutes.spec.ts` (2, each with departures), `account-lifecycle.spec.ts` (2),
`tenant-isolation.spec.ts`, `staff-nav.spec.ts`, `nitrox.spec.ts`, `demo.spec.ts`, and
`visual.spec.ts` (2, each with a departure).

Two things follow, and only the second one is speculative:

1. **The slugs must be unique per run, and two were not.** `demo.spec.ts` used the fixed
   `coral-cove-e2e` and `nitrox.spec.ts` used the fixed `nitrox-off-e2e`, which collide with
   themselves the moment the same database sees the spec twice — a local `playwright test` rerun
   against a `reuseExistingServer` fleet, for one. Both are unique now (`Date.now()` + pid); this
   entry exists so the next author knows the rule rather than rediscovering it.
2. **They may be part of why a long combined run gets slower.** `/api/test/reset` runs a `VACUUM`
   precisely because PGlite has no autovacuum and a full local run otherwise degrades — the comment
   in `src/app/api/test/reset/route.ts` measures 1.2s per reset rising to 8.6s by the 120th call
   before that fix. A combined `visual + functional` run on a contended box still shows resets
   blowing the 15s per-test budget, and a dozen permanent shops (plus their trips, bookings, people
   and logins) are one of the few things in that database that only ever grows. I have **not**
   measured whether they matter, and I am not claiming they do.

## Why it isn't already done

Outside the scope I was given, and the fix needs a decision I would rather someone make
deliberately.

The obvious move — have the reset delete non-demo shops that are not the fixture — is a
harness route learning to hard-delete *real* shops by exclusion rather than by name. That is the
opposite of how every other delete path here is written: `purgeMintedDemoShops` and the TTL reaper
both refuse anything but a minted demo, and `deleteDemoShopCascade`'s own docblock says never to
call it on a real shop. Widening it to "any shop that is not blue-mantis" puts a
delete-everything-else primitive behind a test route, and the guard on that route (`DIVEDAY_E2E` plus
a bearer token) is the only thing between it and a deployment. I did not want to write that on my
own judgement.

The measurement question is also genuinely open: it may be that these shops cost nothing and the
slow resets are only CPU contention, in which case the right outcome is to write that down and close
this.

## Proposed change

First, measure. Instrument or simply time `POST /api/test/reset` across a full combined run
(`pnpm exec playwright test`) and see whether the cost grows with the number of shops in the
database, or tracks machine load. `src/app/api/test/reset/route.ts` already documents how the
previous version of this question was answered (dead tuples, heap size, per-call timings), so
reproduce that method rather than inventing one.

Then, if it matters, the shape I would reach for is an **opt-in** teardown rather than a sweep: a
`DELETE /api/test/seed-private-shop?slug=` already exists for the private-shop fixture and refuses
anything but an `isDemo` shop; a sibling that takes an explicit slug a spec minted and names it
would let each onboarding spec clean up after itself, with no route that can delete a shop nobody
named. `e2e/fixtures.ts`'s `privateShop` is the pattern for hanging that off a fixture teardown.

Not proposed: making these specs use `privateShop`. They exist to test what a shop looks like when
it has just been created, and a private shop arrives fully seeded — it would answer the wrong
question.

Not proposed either: giving trial shops a TTL reaper in production code to solve a test problem.

## Prompt

```text
DiveDay's Playwright fleet gives each worker its own in-memory PGlite database, reset before every
test by `POST /api/test/reset` (`resetDemoSchedule`, scoped to the `blue-mantis` fixture, plus
`purgeMintedDemoShops`, which takes only `isDemo` shops). Around a dozen specs create a *real* trial
shop through `/onboard`, and nothing ever clears those: they accumulate for the life of the worker's
server.

Answer the measurable question first: does that accumulation cost anything?

Read first:
  - src/app/api/test/reset/route.ts — especially `reclaimDeadTuples`, which documents how the last
    version of this question was answered (dead tuples, heap size, 1.2s rising to 8.6s by the 120th
    reset) and states that CI never sees it because it shards onto fresh servers
  - docs/product/follow-ups/FU-20260815-onboarded-trial-shops-accumulate-for-the-life-of-a-run.md
    (this file) — it lists which specs mint what
  - src/db/seed-demo-lifecycle.ts — `purgeMintedDemoShops` and `deleteDemoShopCascade`, and note
    that the cascade's docblock forbids calling it on a real shop
  - src/app/api/test/seed-private-shop/route.ts — its DELETE handler is the shape of a
    named-slug teardown that refuses anything it should not touch

Method: run the combined `pnpm exec playwright test` (every spec, one process — kill any leftover
`next start` fleet on ports 3100+ first, because `reuseExistingServer` will hand the run a stale
build otherwise) and time each `/api/test/reset`. Report whether reset cost tracks the number of
shops in the database or the machine's load average. On a shared dev box this distinction is easy
to get wrong — take a load average alongside every measurement.

If it costs nothing: say so in the ADR or the reset route's comment, and close this by deleting
the file. That is a real outcome, not a failure.

If it costs something: add a teardown that names the slug it created, spec by spec. Do NOT widen
the reset into "delete every shop that is not blue-mantis" — that puts a
delete-everything-else primitive behind a test route whose only protection is the DIVEDAY_E2E
predicate and a bearer token, and it is the opposite of how every other delete path in this repo is
written. And do not convert these specs to the `privateShop` fixture: they exist to test what a
brand-new shop looks like, and a private shop arrives fully seeded.

Done means: the question is answered in writing with numbers, `pnpm check` is green, and either the
teardown lands with the CI-shaped sharded run still passing, or the file is deleted with the finding
recorded where the next person will meet it.
```
