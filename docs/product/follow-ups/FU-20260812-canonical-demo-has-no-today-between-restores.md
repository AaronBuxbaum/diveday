# FU-20260812-canonical-demo-has-no-today-between-restores — Decide whether the canonical demo needs a boat sailing today, not just a board

- **Status:** Open
- **Raised:** 2026-08-12 — the change that added `/api/cron/demo-refresh`
  (ADR 20260812-demo-schedule-keeper)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/demo-refresh.ts`, `src/db/seed-clock.ts`, `src/app/api/cron/demo-refresh/route.ts`

## What I noticed

The new keeper pass restores the canonical `blue-mantis` demo when its board runs down to three
weeks of departures, so the diver-facing schedule the homepage links to always has trips on it.
That is the whole of what it fixes.

What it does not fix is the demo's *today*. `demoTodayDepartureStart` puts one boat on today's
board at seed time — the invariant its own comment states as "today always has a board", because
today's departures are the first thing staff see. With restores landing roughly every six weeks,
that is true on the day of a restore and false on the other forty. Anyone reaching the canonical
demo's staff surfaces in a real deployment — the `DEV_STAFF_LOGINS` sign-ins, `/shop/blue-mantis`,
its Today queue, its manifests, the close-out — sees an empty day for most of the cycle. The
diver-facing half is fine, since a diver looks at what is coming up rather than at today.

This is only a question about the *canonical* fixture in production. "Try the live demo" mints a
fresh shop per visitor and seeds it at click time (ADR 20260724-per-visitor-demo-shops), so the
staff demo a prospect is actually shown always has a boat sailing today.

## Why it isn't already done

It needs a call about what the canonical demo is *for* in production, which is not mine to make.
If it is only the diver-facing preview the marketing page points at, the current threshold is
right and this entry closes as "working as intended". If staff are ever pointed at it — a
screenshot for a pitch, a support session, a shop owner given the sign-in — then a demo whose
"Today" is empty is worse than no demo, and the pass needs to run against a different signal.

Restoring nightly instead was the obvious wrong turn and I deliberately did not take it: the pass
deletes and re-seeds a few thousand rows in one transaction against a publicly bookable shop, and
doing that every night to fix a board nobody has complained about spends real database work and
wipes anything a visitor did, every day.

## Proposed change

Under "diver preview only": nothing to build. Close this entry and add a sentence to ADR
20260812-demo-schedule-keeper saying the canonical demo's staff surfaces are explicitly not kept
current.

Under "staff surfaces matter too": do not lower `DEMO_SCHEDULE_MIN_RUNWAY_DAYS` — that reseeds the
whole shop for one missing row. Add a narrower pass beside it in `src/db/demo-refresh.ts` that
moves the *nearest* seeded departure onto today's `demoTodayDepartureStart` slot when nothing
sails today, leaving the rest of the board and every booking on it alone. Note the trade-off up
front: the roster, waivers and crew attached to that trip travel with it, so today's board would
show a departure whose story was written for a different day.

## Prompt

```text
Read docs/architecture/decisions/20260812-demo-schedule-keeper.md, src/db/demo-refresh.ts, and
src/db/seed-clock.ts (specifically `demoTodayDepartureStart` and its comment) first.

The canonical blue-mantis demo is restored by /api/cron/demo-refresh only when its board runs
below three weeks of upcoming departures — roughly every six weeks. Between restores no seeded
trip sails *today*, so that shop's staff surfaces (/shop/blue-mantis Today queue, manifests,
close-out) render an empty day in production. Decide with the repository owner whether the
canonical demo's staff half is meant to be current at all; the marketing site only links to its
diver-facing schedule, and "Try the live demo" mints a separate fresh shop per visitor.

If it is not meant to be current: delete this follow-up and record the decision in the ADR's
Consequences.

If it is: add a pass beside refreshCanonicalDemoSchedule that gives today a departure without
wiping the shop — moving the nearest upcoming seeded trip onto today's slot rather than lowering
the restore threshold. Cover it in src/db/demo-refresh.test.ts (a shop whose board is healthy but
whose next boat is four days out ends up with one sailing today; a shop that already has one is
left untouched), and log the move on the existing cron_demo_refresh.pass_complete line rather than
adding a second cron.

Either way: run pnpm check, and delete
docs/product/follow-ups/FU-20260812-canonical-demo-has-no-today-between-restores.md as part of
the change.
```
