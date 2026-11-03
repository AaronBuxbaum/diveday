# 20261103-one-roll-call-ledger — Seat and crew marks are one ledger, `roll_call_events`

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md) decision 1 (the separate `roll_call_crew_events` table)

## Context

Crew roll call got its own table in 2026-08 so that `roll_call_events.booking_id` could stay
`NOT NULL`. The price was two copies of everything that reads a head count: newest-wins, replay,
export timeline, erasure. The 2026-09-18 review (idea L01-2, issue #2700) found four such tap ledgers; this decision
folds the first pair. Aaron chose to build it on 2026-11-02 (group 6).

## Decision

1. **One table.** `roll_call_events` carries `subject_kind` (`seat` | `crew`, enum
   `roll_call_subject_kind`), a nullable `booking_id` and a nullable `crew_person_id`.
   `roll_call_events_subject` is the invariant the separate table used to give us: a seat row names
   a booking and no crew member, a crew row names a crew member and no booking. A check
   constraint, as in `buddy_pair_members_one_subject`.
2. **Each half keeps its own evidence.** A seat's readiness and card snapshots and its
   `offline_snapshot_saved_at`, and a crew member's credential snapshot, are refused on the other
   kind by check constraints.
3. **Every query names its half.** `seatMarks()` / `crewMarks()` (`src/db/roll-call-subject.ts`),
   enforced by `scripts/check-roll-call-subject.mjs` in `pnpm check:repo`. A join to `bookings`
   happens to drop crew rows; the guard does not accept that as the scope. A query that means both
   halves says `diveday:roll-call-both-subjects: <why>`.
4. **One id namespace for offline replay.** Seat and crew share
   `roll_call_events_shop_client_event_unique`; the replay subject names its kind, so a crew event
   under an id a seat mark holds is `client_event_conflict`, never `duplicate`.
5. **Expand, then contract.** The column defaults to `seat` so the release serving during the
   migration keeps writing diver rows. A custom migration copies `roll_call_crew_events` across and
   a trigger follows the outgoing release's inserts, updates (erasure) and deletes by id; the new
   release never touches it. Old screens miss new crew taps until rollout ends.
   All three drop next release (#3729).
6. **The export keeps its two files.** `roll_call_events.csv` holds seats and
   `roll_call_crew_events.csv` holds crew, split by `subject_kind`; a shop diffing last week's
   bundle sees the same files.

## Alternatives considered

- **Keep two tables.** The invariant it protected is now one check constraint.
- **A Postgres view per half.** Reads would stay unchanged, but writes and the replay check still
  need the table, and a view hides the fact that a query must choose a half, which is the point.
- **Name the column `person_id`.** Seat rows reach a person too; `crew_person_id` says whose it is.

## Consequences

- One newest-wins rule, one `seq`, one replay check and one erasure update per field for both
  halves; a crew note and a diver note are erased by the same statement shape.
- A new reader has to choose a half or say why not, and the guard tells them so.
- The diver merge's staff check reads the column the person registry names, since
  `crew_person_id` is not `person_id`.

Nothing about who may sail changes. Arrival and the pre-departure check are the next layers of #2700.
