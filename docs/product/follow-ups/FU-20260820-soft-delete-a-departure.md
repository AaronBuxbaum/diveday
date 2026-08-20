# FU-20260820-soft-delete-a-departure — Make deleteTrip a soft delete like everything else

- **Status:** Open
- **Raised:** 2026-08-20 — writing ADR 20260820-every-delete-is-soft, which extends soft deletion from six named entities to every entity
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/db/trips-schedule.ts`, `src/db/schema.ts`, `src/db/trips-schedule.test.ts`, `src/app/shop/[shopSlug]/schedule/board/actions.ts`

## What I noticed

`deleteTrip` in `src/db/trips-schedule.ts` is the last hard delete of a thing a shop can point at.
It removes rows from `trip_last_minute_promos`, `trip_assignments`, `trip_requirements`,
`trip_dives`, `trip_schedule_days`, and then `trips` itself, inside one transaction. It is guarded:
it refuses with `has_roster` when any booking or wait-list entry exists, and `already_sailed` when
roll-call evidence exists, so today it can only destroy an empty departure that never sailed. That
guard is why nothing has gone wrong yet, and it is also why this is easy to miss.

The behaviour a person would see: a shop owner builds next Saturday's 8am boat, taps delete on the
wrong row before anyone has booked, and it is gone with its per-dive plan, its site assignments, its
crew, and its multi-day schedule days. There is no undo, and no support path short of a database
restore. Every other entity in the app survives that mis-tap.

## Why it isn't already done

Outside the scope of the change that raised it — that change defined the rule and wrote the ADR, it
did not migrate the tree. This one also deserves its own review rather than a drive-by: `trips` is
joined from manifests, closeout, the series horizon roll, the sitemap, and the public schedule, so
adding `deleted_at` means auditing every one of those readers for the filter, not just adding a
column. Getting that wrong shows a deleted departure on a public booking page.

## Proposed change

Add `deleted_at` to `trips` in `src/db/schema.ts`, and turn `deleteTrip`'s six delete statements
into one `deleted_at` write on `trips` (children stay attached; they are already unreachable once
the parent is filtered out). Keep `recordSeriesSkip` exactly where it is — a deleted series instance
must still leave a skip so the horizon roll does not put it back.

Then audit every `trips` reader for `deleted_at is null`: `src/db/trips-schedule.ts`,
`trips-roster.ts`, `trips-record.ts`, `trips-series.ts`, `src/db/today.ts`, `src/db/blockers.ts`,
`src/db/closeout.ts`, `src/lib/manifests.ts`, and the public schedule and sitemap readers. A missing
filter on the public side is the failure that matters.

Do **not** relax the two existing refusals into "it is soft now, so let it through" — a departure
with a roster is a different question (those divers need telling), and that decision is not part of
this cleanup. Keep `has_roster` and `already_sailed` exactly as they are.

## Prompt

```text
Make trip deletion soft, per ADR docs/architecture/decisions/20260820-every-delete-is-soft.md.

Read first: docs/architecture/decisions/20260820-every-delete-is-soft.md, then
src/db/trips-schedule.ts (deleteTrip and recordSeriesSkip), then src/db/trips-schedule.test.ts.
Read the schema-change skill before editing src/db/schema.ts.

deleteTrip currently hard-deletes trips plus five child tables. Add a deleted_at timestamp column to
the trips table and make deleteTrip set it instead, leaving children attached. Keep the
recordSeriesSkip write and keep both existing refusals (has_roster, already_sailed) unchanged — this
change is about how a permitted delete is stored, not about what is permitted.

The non-obvious part: every reader of trips must now filter deleted_at is null. Audit
src/db/trips-schedule.ts, trips-roster.ts, trips-record.ts, trips-series.ts, src/db/today.ts,
src/db/blockers.ts, src/db/closeout.ts, src/lib/manifests.ts, and the public schedule and sitemap
readers under src/app/s/[shopSlug]. A deleted departure appearing on a public booking page is the
failure this has to rule out, so write a test for that case specifically.

Done when: a regression test proves a deleted trip's row survives and is absent from the staff
schedule board, the public schedule, and the sitemap; pnpm check is green; and
pnpm e2e e2e/schedule-builder.spec.ts --reporter=line passes. Delete
docs/product/follow-ups/FU-20260820-soft-delete-a-departure.md as part of the change.
```
