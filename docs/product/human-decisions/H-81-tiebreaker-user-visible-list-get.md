# H-81: What tiebreaker does a user-visible list get?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**What tiebreaker does a user-visible list get?** About thirty readers order by `created_at` then a `defaultRandom()` id. In production two rows are microseconds apart so the id never runs; under the frozen test clock every row shares one instant and the whole order is a random uuid. Two visual baselines have already re-ordered themselves on commits touching neither the surface nor the query — the boat manifest's rail numbering and the lobby-display Screens list. Filed as #1762, with #1759, #1795 and #1708 adjacent.

## Minimum outcome to record

Whether a sweep alone, or a sweep plus a guard.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): sweep, then guard.** Each user-visible reader gets a tiebreaker a person can predict — a name, a label, a code — with the id last for totality, and `src/db/export.ts` is left alone with the reason written at the clause. A `check:repo` guard then refuses an `orderBy` whose last two keys are a timestamp and a `defaultRandom()` id outside `export.ts` unless the line carries a written reason, so the next one never ships rather than being found in a diff image months later. #1759: the manifest roster keeps the diver's **name** as its tiebreaker — a name-ordered rail is the one a second caller can check in a single pass, and a bigserial buys immunity to a rename at the price of a number no human can predict; the rename-mid-print case is the accepted cost. #1795 settles the export rule in the file: a CSV a shop reads or diffs gets a predictable order, a bundle that exists only to be re-imported does not. #1708 is a free-standing yes — one migration giving `dive_sites.name`, `gear_items.label` and `courses.title` the ICU collation `people.full_name` already carries.

Part of the [human decision log](README.md#decision-register).
