# dive-participation

This module owns the dive participation note (issue #4307; glossary "Dive participation note"):
the crew saying one diver dived, sat out, or is unknown for one dive of the day, and publishes its
contract through `index.ts`.

## Owns

- `store.ts`: `recordDiveParticipation`, the append-only write that re-proves the staffer, the
  departure, the dive number and the seat against the shop; `diveParticipationForTrip`, the newest
  note per seat and dive; `satOutDives`, the dives one seat sat out.

## Does not own

The schema (`dive_participation_notes` in `src/db/schema/dive-day.ts`), the three states
(`src/lib/dive-participation.ts`), the person sheet's control and the recap's reading stay in
their layers.

## Invariants

No note is `unknown`, and `unknown` is never "did not dive". A note is never inferred from a
roll-call mark, and nothing here reads or writes the roll call, the head count, readiness, a
medical hold or fly-safe. Every read and write is scoped by the shop.
