---
name: schema-change
description: How to change the database schema (Drizzle/Postgres/PGlite) safely — new tables, columns, enums, constraints, indexes. Use whenever editing src/db/schema.ts or when a feature needs new persistent state.
---

# Change the schema

`src/db/schema.ts` is the source of truth; `drizzle/` holds generated SQL migrations, which are
**committed** and never hand-edited (ADR-0005). Never read `drizzle/` to answer schema
questions — read `schema.ts`.

## Steps

1. **Edit `src/db/schema.ts`.** Keep TS unions aligned with their pg enums (e.g. `Role` in
   `src/lib/authz.ts` ↔ `person_role`). Multi-tenancy rule: every domain table carries
   `shop_id`. A surprising modeling choice gets an ADR; a new domain concept goes in the
   glossary — same PR.
2. **Generate the migration**: `pnpm db:generate` (drizzle-kit will prompt a name via
   `--name=<kebab-slug>` — always name it). Review the generated SQL once — you are the only
   reviewer there will be.
3. **Update `src/db/seed.ts`** if dev/e2e needs rows in the new table — e2e boots from the seed,
   so an unseeded feature is an untested feature.
4. **Test against the new schema.** Unit/integration tests boot PGlite from the committed
   migration chain via `createTestDb()` — the column exists as soon as the migration does.
   Write failure-path tests for new constraints (unique violations, FK violations), not just
   happy paths.
5. **Run the coverage guards before you push.** Touching `src/db/schema.ts` at all — a whole table
   or a single column — is the trigger, not the shape of the change:

   ```bash
   pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts --reporter=dot
   ```

   Three files, 40 tests, about a minute. They assert over `schema.ts` from files your change will
   not touch, so a focused `pnpm test <file>` never selects them and you learn about them from CI
   instead — which is how 16g's four columns, 16i's `recap_pulses` table *and* its
   `addressed_by_person_id`, and 16j-B's two `person_id` columns all went red after a push. An
   unclassified `person_id` is the expensive one: a merge silently leaves rows pointing at a
   removed diver. `pnpm test:changed` selects these too, but after a `schema.ts` edit it selects
   the *whole* suite (9,391 of 9,391 entries, measured 2026-09-06) — that run belongs to CI.
6. **Local sanity**: `pnpm db:reset && pnpm e2e` exercises the auto-migrate + auto-seed boot
   from zero.
7. **Commit together**: `schema.ts`, `drizzle/**`, seed, tests, docs. One schema change per PR
   where possible.

## Removing something

**There is no legacy data. Delete it** (H-49 in `docs/product/human-decisions.md`, extending H-47).
DiveDay is pre-pilot: no users, nothing anyone would miss. So when you find a table, column or enum
value nothing writes any more:

- **Drop it.** Do not add a column so its dead rows sort deterministically, do not write a backfill
  to make old rows resemble new ones, and do not add a dual-read path so a reader tolerates both
  shapes. Each of those is a migration spent on rows that have never had a reader — three follow-ups
  proposed exactly that in one week.
- **Take the code with it.** A writer with no production caller, its tests, its CSV column in
  `src/db/export.ts`, its seed references, and its glossary entry all go in the same change. A table
  kept alive only by its own test suite is the shape to watch for: grep the writer's name and see
  whether anything outside `*.test.ts` calls it.
- The absence of a compatibility path is **not** an oversight to fix.

**What this does not relax**, because it is not about the value of the data:

- The **destructive-migration guard** (`pnpm check:migrations`, ADR 20260806) still applies. It
  exists because a migration runs inside the production build *while the previous release is still
  serving* — a deploy-time problem that having no users does not solve. Your `DROP TABLE` still
  carries its acknowledgement line, and `pre-pilot, no users, H-49` is now a sufficient *why*:
  ```sql
  -- diveday:allow-destructive drop-table roll_call_crew_attestations: retired by H-46; no production caller, pre-pilot, no users (H-49)
  ```
- **Expand/contract** still applies for the same reason: if the *currently deployed* code reads the
  thing you are dropping, split it across two deploys regardless of how worthless the data is.
- **H-02's retention windows and the erasure path** stand. Those are promises about data we *will*
  hold, not tolerance for data we already have.

This rule expires when the first pilot shop has real divers in the system. Aaron says when; it is
not an agent's call, and the H-49 row is where it gets retired.

## Two branches, two migrations

`drizzle/` is a **DAG, not a list.** Each migration folder carries a full `snapshot.json` naming its
parents in `prevIds` (drizzle-kit 1.0 dropped `journal.json`, which is why nothing conflicts in git
any more). A branch cut from main today generates a migration whose `prevIds` point at whatever
main's head was *then* — so two sessions that each add a migration and each merge cleanly leave the
graph with **two open heads**.

`drizzle-kit check` walks every fork point and compares the branches hanging below it. Two heads
that touch different tables are fine and stay quiet. Two heads that touch the same object — two
columns on `shops`, which this repo does most weeks — are refused, and the same walk runs inside
`drizzle-kit migrate`, i.e. **inside the production build**. On 2026-08-22 that is exactly how it
was found: `main` deployed, died at 11:58 printing a tree diagram, and the offending change was
already merged.

**The fix is never to rewrite either migration.** They are both correct; they just never met.

```
pnpm db:merge
```

That writes one migration folder whose SQL is empty and whose snapshot names every open head as a
parent, closing the diamond — a fork whose branches reach a common leaf is skipped by the walk
entirely. Commit it alongside whatever provoked it. `drizzle/20260822212616_merge-migration-heads`
is the worked example, and its SQL comment explains itself to whoever opens it next.

`pnpm db:merge` also **repairs its own snapshot**, and that is not decoration.
`drizzle-kit generate --custom` writes the merge folder's snapshot as *one head's
state whole* — losing the other's — whenever the two open heads **share a
parent**, which is the ordinary shape once a repository has merged a few times.
This repository shipped one: the merge closing `shop-units-confirmed` and
`dive-package-line-item` kept `dive_packages` and dropped
`shops.units_confirmed_at`, so the next `pnpm db:generate` re-emitted that column
as a fresh `ADD COLUMN` against a database that already had it (issue #852).

That failure is invisible where it is cheap to find — the merge folder's SQL is
empty either way, a fresh database applies the chain in order and is fine, and
every test passes. It fails against a database that already ran the original,
which is the `real-postgres` job or production. So the script now probes with a
plain `generate` afterwards, adopts that snapshot's state if anything was lost,
and says so on stdout. If it reports a repair, nothing is wrong with your change;
read the SQL it prints to see what had gone missing.

Two things to hold on to:

- **Read the diagram before running it.** If two branches genuinely add the *same* column, a merge
  folder silences the check and the second `ADD COLUMN` still fails against a real server. The
  `real-postgres` CI job catches that; the resolution there is to regenerate one migration on top of
  the other, not to merge.
- **A merge folder is not a substitute for rebasing.** If you are still on your branch and main has
  moved, rebase and regenerate — that produces a single head with no extra folder at all. `pnpm
  db:merge` is for the case where both migrations are already on main.

## Hard prohibitions

- Never hand-edit a migration that has been pushed (applied history is immutable) — ship a new
  migration instead.
- Never resolve a merge conflict inside `drizzle/` by hand: revert your migration files, rebase,
  regenerate from the merged `schema.ts`, and re-commit. See "Two branches, two migrations" below
  for the case where nothing conflicts in git and the graph still ends up with two heads.
- Never run destructive SQL against a database you didn't create this session.

## Notes

- Migrations apply automatically in dev/test (`getDb()`/`createTestDb()` run the migrator);
  there is no manual migrate step locally. Production migration application will be defined
  with the hosting ADR.
- `pnpm check:migration-graph` (inside `pnpm check:repo`) is what keeps parallel sessions from
  colliding on the graph; the section above is its remedy. It reads files only — no database, no
  credential — so it answers the same on a laptop as in CI.
