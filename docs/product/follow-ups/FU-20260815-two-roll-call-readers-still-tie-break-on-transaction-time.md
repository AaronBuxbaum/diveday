# FU-20260815-two-roll-call-readers-still-tie-break-on-transaction-time — Give crew attestations the monotonic tiebreak the two event tables now have

- **Status:** Open
- **Raised:** 2026-08-15 — closing FU-20260815-offline-carry-forward-and-roll-call-sequence
  (ADR 20260815-roll-call-order-is-a-property-of-the-data). **Trimmed the same day**: four of the
  five readers this entry originally named have been fixed; only the attestation table is left,
  and it is left because it needs a migration this entry did not scope.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/schema.ts`, `src/db/incident-export.ts`, `src/db/export.ts`

## What I noticed

`roll_call_events` and `roll_call_crew_events` carry a monotonic `seq`, and it is now the final
ordering key in every reader of both: `src/db/manifests.ts` (six reads), `src/db/today.ts` (both
reads, ascending — that pass keeps the last row it sees), `src/db/incident-export.ts` (both), and
`src/db/export.ts` (both, where it *replaced* a `defaultRandom()` uuid rather than following it).
`maxRecordedDiveNumber` in `src/lib/manifests.ts` takes an optional `seq` and `src/db/trips-record.ts`
selects it. `src/db/today.test.ts`'s "agrees with the manifest when two events tie on both
timestamps" constructs a real tie inside one transaction and pins Today and the manifest to the same
answer; it fails if either loses the key.

**`roll_call_crew_attestations` did not get the column**, so two reads still tie on a key that
cannot separate them:

1. `src/db/incident-export.ts:108` orders `asc(occurredAt), asc(createdAt)`. `created_at` is
   `defaultNow()` — *transaction* time — so two attestations written in one transaction tie on both.
   That document's footer carries a SHA-256 integrity code over the printed facts, so two
   regenerations of an unchanged record can hash differently, which reads as tampering.
2. `src/db/export.ts:432` ties on `asc(id)`, which is `defaultRandom()` — so any `occurred_at` tie
   orders that CSV differently on every export, in the one file a shop is meant to be able to diff
   against last week's.

The blast radius is genuinely smaller than the event tables': attestations are **retired** (ADR
20260804-crew-roll-call-is-per-person), so no new rows are written and no live surface reads them.
What remains is historical rows that the departure log renders and the export carries.

## Why it isn't already done

The four reader fixes were one-line ordering changes on tables that already had the column. This one
needs a schema change — `seq bigserial` on `roll_call_crew_attestations` plus a migration — and that
deserves its own review rather than being appended to a sweep, on a table whose rows are statements
humans made about departures that sailed.

There is also a real question underneath it, which is why this is worth a moment's thought rather
than a mechanical repeat: the table is retired, so a column added now protects only rows that
already exist and can never grow. That may still be worth it (the integrity code is the argument),
but "add the column everywhere for symmetry" is not the reason — and if the answer is no, the honest
close is to say so where the next reader will meet it.

## Proposed change

Either:

- **Add `seq bigserial NOT NULL` to `roll_call_crew_attestations`** (additive; `pnpm check:migrations`
  refuses destructive DDL in a release window), and make it the final key on both reads above,
  replacing `asc(id)` in `export.ts` rather than following it — a random uuid above a monotonic
  sequence makes the sequence unreachable. Mirror `rollCallEvents.seq`'s schema docblock, including
  its "never serialise it: the sequence is database-global, not per shop" warning.
- **Or decide the retired table does not earn a migration**, and record that in
  ADR 20260815-roll-call-order-is-a-property-of-the-data beside the reasoning for the two tables that
  did — naming the residual: a departure log for a pre-2026-08-04 trip can hash two ways.

**Not proposed:** moving `created_at` onto the frozen application clock. That is the change that
makes the collision certain rather than hypothetical (see the ADR).

## Prompt

```text
DiveDay's two roll-call event tables gained a monotonic `seq` on 2026-08-15 (ADR
20260815-roll-call-order-is-a-property-of-the-data) and it is now the final ordering key in every
reader of both. The third, retired table -- `roll_call_crew_attestations` -- did not get it, so two
reads still tie on a key that cannot separate them.

Read docs/product/follow-ups/FU-20260815-two-roll-call-readers-still-tie-break-on-transaction-time.md
first, then src/db/incident-export.ts around line 108 and src/db/export.ts around line 432, and
`rollCallEvents.seq`'s docblock in src/db/schema.ts for the pattern and its warnings.

Decide FIRST whether the column is worth adding at all, and say why in writing: the table is retired
(ADR 20260804-crew-roll-call-is-per-person), so no new rows are written and a column added now
protects only rows that already exist. The argument FOR is that the departure log's footer carries a
SHA-256 integrity code over the printed facts, so a tie means one unchanged record can hash two ways
-- which reads as tampering to whoever a shop handed it to. "Symmetry with the other two tables" is
NOT a sufficient reason.

If yes: add `seq bigserial NOT NULL` to roll_call_crew_attestations, generate the migration with
pnpm db:generate (additive only -- pnpm check:migrations refuses destructive DDL in a release
window), and make it the final ordering key on both reads. In export.ts it must REPLACE `asc(id)`,
not follow it: the id is defaultRandom(), and a random uuid above a monotonic sequence makes the
sequence unreachable. Add a test that constructs a real tie -- two attestations inserted inside ONE
db.transaction with the same occurredAt -- and asserts the departure log renders them in append
order; src/db/today.test.ts's "agrees with the manifest when two events tie on both timestamps" is
the pattern for proving the tie is real before asserting who wins.

If no: record the decision and the residual in
docs/architecture/decisions/20260815-roll-call-order-is-a-property-of-the-data.md.

Do NOT "fix" this by moving created_at onto the frozen application clock.

Run pnpm test src/db/incident-export.test.ts src/db/export.test.ts --reporter=dot and pnpm check.
Delete docs/product/follow-ups/FU-20260815-two-roll-call-readers-still-tie-break-on-transaction-time.md
as part of the change.
```
