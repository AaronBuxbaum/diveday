# FU-20260821-a-diver-note-never-reaches-that-divers-trail — Decide whether a record-scoped note's activity line should belong to the diver it names

- **Status:** Open
- **Raised:** 2026-08-21 — the branch that added the Activity panel to the diver record (`claude/diver-activity-and-row-actions-7f3a2c`)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/db/operations.ts`, `src/db/anonymize.ts`, `src/app/shop/[shopSlug]/divers/[personId]/_components/ActivitySection.tsx`

## What I noticed

`addDiverNote` (`src/db/operations.ts`) writes its activity line with **both** foreign keys null:

```ts
await tx.insert(activityEvents).values({
  shopId: input.shopId,
  tripId: null,
  bookingId: null,
  actorPersonId: input.actorPersonId,
  message: `${actor.name} added a private note about ${diver.name}`,
  ...
});
```

`deleteDiverNote` writes the matching "deleted a private note about …" line the same way.

The new Activity panel on a diver's record reads `pagedDiverActivity`, which claims a line for a
person when `booking_id` is one of their bookings **or** `actor_person_id` is them. A
record-scoped note is neither: the diver it is *about* is named only inside the free-text
`message`. So a staffer who adds a private note to Priya's record sees that line on the trail of
the staffer who wrote it, and never on Priya's — the record it was written on. The trip-scoped
`addInternalNote` does not have this problem, because it carries the seat's `booking_id`.

Concretely: open a diver's record, add a note under "Diver notes", scroll to Activity. Nothing
new appears. Reload — still nothing.

## Why it isn't already done

The reader's predicate is deliberately the *same* predicate `anonymizeDiver` redacts under
(`src/db/anonymize.ts`, the `activity_events` sweep). That is what makes "the set a shop can read
about a person" and "the set an erasure destroys" identical by construction rather than by two
functions agreeing. Widening the reader alone would break that pairing and quietly leave lines
readable on a record after an erasure had been run — the exact failure the pairing exists to
prevent. Widening *both* is a change to the erasure blast radius, which belongs with a
`security-reviewer` pass rather than smuggled into a UI change.

There is also a real design question underneath, and I do not think an agent should answer it:
`activity_events` has no `subject_person_id`. Every other line in the table is about a departure
or a seat. A "which person is this about?" column is a small schema change but a genuine widening
of what the table means.

## Proposed change

Two options, and I would take the first:

1. **Add `activity_events.subject_person_id`** (nullable, FK to `people`, indexed with `shop_id`).
   `addDiverNote`/`deleteDiverNote` set it; `pagedDiverActivity` adds `eq(subject_person_id, …)`
   to its `or(...)`; `anonymizeDiver`'s activity sweep adds the identical clause so the two stay
   the same set. Migration is additive — no destructive-migration line needed. Backfill is not
   needed: there are no users (H-49), and the fuzzy name sweep in `anonymizeDiver` already catches
   the existing rows by name.
2. **Do nothing, and say so** in `pagedDiverActivity`'s docstring — a record note already renders
   in its own "Diver notes" section on the same page, so the trail arguably should not repeat it.
   This is defensible; it just should be a decision rather than an accident.

What I am **not** proposing: matching on the diver's name inside `message` at read time. The
erasure code already has a word-boundary name matcher and its docstring explains at length why a
short name makes that unbounded — a read-time version would have the same hazard with none of the
one-shot-transaction containment.

## Prompt

```text
Read docs/product/follow-ups/FU-20260821-a-diver-note-never-reaches-that-divers-trail.md, then
src/db/operations.ts (`addDiverNote`, `deleteDiverNote`, `pagedDiverActivity`) and the
`activity_events` sweep in src/db/anonymize.ts.

Decide between the two options in that entry. If you take option 1, the constraint that makes it
non-obvious is that `pagedDiverActivity`'s predicate and `anonymizeDiver`'s activity-redaction
predicate must stay the *same set* — change both in one commit, and add a test in
src/db/operations.test.ts that a record-scoped note appears on the subject's trail AND reads
`[redacted]` after `anonymizeDiver` runs on them. Schema work follows the `schema-change` skill
(edit src/db/schema.ts, then `pnpm db:generate`); the migration is additive so it needs no
`diveday:allow-destructive` line. Get a `security-reviewer` pass before merge — this widens what
an erasure destroys.

Done when: `pnpm check` is green, the new unit tests cover both halves of the pair, and
docs/product/follow-ups/FU-20260821-a-diver-note-never-reaches-that-divers-trail.md is deleted as
part of the change.
```
