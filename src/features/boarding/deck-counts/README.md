# deck-counts

This module owns the deck count (issue #4248): the heads a crew member counted on deck at a
roll-call checkpoint, and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: `parseDeckCount` and `compareDeckCount`, pure.
- `store.ts`: `recordDeckCount`, the append-only write that re-proves the staffer, the departure and
  the checkpoint, and `latestDeckCounts`, the newest count per checkpoint.

## Does not own

The schema (`roll_call_deck_counts` in `src/db/schema/dive-day.ts`) and the manifest surface stay
in their layers.

## Invariants

A deck count informs and never gates: nothing here reads or writes the roll call, and no
completeness verdict reads a deck count. Every read and write is scoped by the shop.
