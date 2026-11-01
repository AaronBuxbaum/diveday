---
name: schema-change
description: Change the database schema safely (Drizzle, PGlite) — tables, columns, enums, constraints, indexes. Use when editing src/db/schema/ or when a feature needs new persistent state.
---

# Change the schema

`src/db/schema/` (one module per domain, re-exported by `index.ts`) is the source of truth; `drizzle/` holds generated SQL migrations, which are
**committed** and never hand-edited (ADR-0005). Never read `drizzle/` to answer schema
questions — read the schema module.

## Steps

1. **Edit the domain's module under `src/db/schema/`** (a new table goes beside its domain; a
   new domain gets a module and an `export *` line in `index.ts`). Keep TS unions aligned with their pg enums (e.g. `Role` in
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
5. **Run the coverage guards before you push.** Touching any file under `src/db/schema/` — a whole table
   or a single column — is the trigger, not the shape of the change. The command is step 3 of the
   **verify** skill's checklist: four files, 40 tests, about a minute. They assert over the schema from files your change will
   not touch, so a focused `pnpm test <file>` never selects them and you learn about them from CI
   instead — which is how 16g's four columns, 16i's `recap_pulses` table *and* its
   `addressed_by_person_id`, and 16j-B's two `person_id` columns all went red after a push. An
   unclassified `person_id` is the expensive one: a merge silently leaves rows pointing at a
   removed diver. An import-graph run selects these too, but after a schema edit it selects
   the *whole* suite (9,391 of 9,391 entries, measured 2026-09-06) — that run belongs to CI.
6. **Local sanity**: `pnpm db:reset && pnpm e2e e2e/<the spec your change touches>.spec.ts --reporter=line` exercises the auto-migrate + auto-seed boot
   from zero.
7. **Commit together**: the schema module, `drizzle/**`, seed, tests, docs. One schema change per PR
   where possible.

## Reference

- [removing.md](removing.md) — dropping a table, column or enum value: there is no legacy data, so delete it (H-20260815-no-legacy), and what that does not relax.
- [two-branches.md](two-branches.md) — two migrations on two branches: `drizzle/` is a DAG, and how to collapse two heads into one.

## Hard prohibitions

- Never hand-edit a migration that has been pushed (applied history is immutable) — ship a new
  migration instead.
- Never resolve a merge conflict inside `drizzle/` by hand: revert your migration files, rebase,
  regenerate from the merged schema, and re-commit. See [two-branches.md](two-branches.md)
  for the case where nothing conflicts in git and the graph still ends up with two heads.
- Never run destructive SQL against a database you didn't create this session.

## Notes

- Migrations apply automatically in dev/test (`getDb()`/`createTestDb()` run the migrator);
  there is no manual migrate step locally. Production migration application will be defined
  with the hosting ADR.
- `pnpm check:migration-graph` (inside `pnpm check:repo`) is what keeps parallel sessions from
  colliding on the graph; [two-branches.md](two-branches.md) is its remedy. It reads files only — no database, no
  credential — so it answers the same on a laptop as in CI.
