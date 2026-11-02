# Schema change: removing something

Part of the **schema-change** skill ([SKILL.md](SKILL.md)). Read it before dropping or renaming a table, column or enum value, or when tempted to backfill old rows.

## Removing something

**There is no legacy data. Delete it** (H-20260815-no-legacy in `docs/product/human-decisions/README.md`, extending H-20260814-production-database-disposable).
DiveDay is pre-pilot: no users, nothing anyone would miss. So when you find a table, column or enum
value nothing writes any more:

- **Drop it.** Do not add a column so its dead rows sort deterministically, do not write a backfill
  to make old rows resemble new ones, and do not add a dual-read path so a reader tolerates both
  shapes. Each of those is a migration spent on rows that have never had a reader — three follow-ups
  proposed exactly that in one week.
- **Take the code with it.** A writer with no production caller, its tests, its CSV column in
  `src/db/export-shop-files.ts` (and `export-diver-files.ts`), its seed references, and its glossary entry all go in the same change. A table
  kept alive only by its own test suite is the shape to watch for: grep the writer's name and see
  whether anything outside `*.test.ts` calls it.
- The absence of a compatibility path is **not** an oversight to fix.

**What this does not relax**, because it is not about the value of the data:

- The **destructive-migration guard** (`pnpm check:migrations`, ADR 20260806) still applies. It
  exists because a migration runs inside the production build *while the previous release is still
  serving* — a deploy-time problem that having no users does not solve. Your `DROP TABLE` still
  carries its acknowledgement line, and `pre-pilot, no users, H-20260815-no-legacy` is now a sufficient *why*:
  ```sql
  -- diveday:allow-destructive drop-table roll_call_crew_attestations: retired by H-20260814-where-diveday-sit-between; no production caller, pre-pilot, no users (H-20260815-no-legacy)
  ```
- **Expand/contract** still applies for the same reason: if the *currently deployed* code reads the
  thing you are dropping, split it across two deploys regardless of how worthless the data is.
  For a column the guard enforces it: a `drop-column` marker is refused while the previous
  release's or this branch's `src/db/schema/` still declares the column, whatever the reason says.
- **H-20260730-evidence-retention-period-deletion's retention windows and the erasure path** stand. Those are promises about data we *will*
  hold, not tolerance for data we already have.

This rule expires when the first pilot shop has real divers in the system. Aaron says when; it is
not an agent's call, and the H-20260815-no-legacy row is where it gets retired.
