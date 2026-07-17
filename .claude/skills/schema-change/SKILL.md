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
5. **Local sanity**: `pnpm db:reset && pnpm e2e` exercises the auto-migrate + auto-seed boot
   from zero.
6. **Commit together**: `schema.ts`, `drizzle/**`, seed, tests, docs. One schema change per PR
   where possible.

## Hard prohibitions

- Never hand-edit a migration that has been pushed (applied history is immutable) — ship a new
  migration instead.
- Never resolve a merge conflict inside `drizzle/` by hand: revert your migration files, rebase,
  regenerate from the merged `schema.ts`, and re-commit. Drizzle snapshots are a linear chain —
  two branches generating in parallel WILL conflict; regeneration is the only safe resolution.
- Never run destructive SQL against a database you didn't create this session.

## Notes

- Migrations apply automatically in dev/test (`getDb()`/`createTestDb()` run the migrator);
  there is no manual migrate step locally. Production migration application will be defined
  with the hosting ADR.
- If parallel agent sessions start colliding on the snapshot chain regularly, adopt a
  serialized finalizer (CI regenerates migrations on the PR); the sibling project sybaris has a
  working reference implementation.
