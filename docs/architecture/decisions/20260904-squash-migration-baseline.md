# 20260904-squash-migration-baseline — One baseline migration, and its folder name is load-bearing

- **Status:** Accepted
- **Date:** 2026-09-04
- **Closes:** issue #1343, against that issue's own recommendation and its explicit "do not squash
  the migration history" instruction. Both of the blockers it gave for that instruction turned out
  to be false; the Context below shows where.
- **Alongside:** 20260806-destructive-migration-guard, which still governs everything added *after*
  the baseline. The baseline is not exempt from expand/contract — it is what expand/contract now
  starts from.

## Context

`drizzle/` held 202 forward-only migration folders. The `migration.sql` files that actually run
totalled 0.21 MB; the 201 `snapshot.json` files beside them were **83 MB**, and grew by about
2.56 KB per migration because each is a complete dump of the schema at that point in history. Both
terms of that product were still rising.

Issue #1343 proposed excluding the snapshots from the deploy upload and explicitly ruled the squash
out, on two grounds. Neither survives contact with the installed `drizzle-orm@1.0.0-rc.4`:

- **"`drizzle-kit migrate` exposes no `init` mode."** It does. `migrate()` accepts `config.init`
  (`drizzle-orm/pg-core/async/session.js`), which stamps a single migration as applied *without
  executing it*, refusing when the database already holds migrations or the folder holds more than
  one. That is precisely the baseline-an-existing-database primitive the issue said did not exist.

- **"`getMigrationsToRun` matches by `name`, so squashing is unsafe."** It matches by name, and
  that is what makes the squash safe rather than what blocks it (`drizzle-orm/migrator.utils.js`):

  ```js
  const dbNamesSet = new Set(dbMigrations.map((m) => m.name).filter((n) => n !== null));
  return localMigrations.filter((lm) => !lm.name || !dbNamesSet.has(lm.name));
  ```

  Not a hash. Not a timestamp. A name already recorded in `__drizzle_migrations` means the local
  file is skipped, whatever its contents.

A third claim in the issue was wrong in a way that cost the most reading time: `drizzle-kit migrate`
never opens `snapshot.json` at all. `readMigrationFiles` maps `readdirSync(folder)` to
`join(subdir, "migration.sql")` and filters on that existing. Snapshots feed only the commutativity
walk in `scripts/check-migration-graph.mjs`.

## Decision

**One baseline migration, whose folder reuses the *first* migration's name,
`20260721131359_cheerful_masque`.**

That name is the mechanism, not a cosmetic choice:

- A database that already ran the old history has that name in `__drizzle_migrations`, so
  `getMigrationsToRun` filters the baseline out and it never executes against populated tables.
- A virgin database has no rows, so the baseline runs and creates the whole schema.

**Renaming that folder silently breaks this**, and breaks it in the worst direction: the baseline
would stop being skipped and would run `CREATE TABLE` against a database that already has the
tables. The name is therefore a correctness constraint, recorded here, in the runbook's rollback
row, and at the top of the migration itself.

### Three statements a regenerated baseline does not contain

`drizzle-kit generate` reads `src/db/schema.ts`, which cannot express any of these. Any future
squash must re-add them by hand, and they are carried in the current baseline with their original
reasoning:

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm` — CR-018's trigram search indexes. The *indexes* are in
   `schema.ts` and do regenerate; the extension they need does not.
2. `CREATE EXTENSION IF NOT EXISTS btree_gist` — supplies the gist opclass for `uuid =`.
3. `gear_reservations_no_overlap`, the `EXCLUDE USING gist` double-booking guard
   (ADR 20260815-minimal-gear-register).

Deliberately **not** carried: the 16 `UPDATE`s, 2 `INSERT`s and 6 `DO $$` preflight blocks the old
set contained. Every one backfilled or validated rows that existed when it was written, and a
baseline creates empty tables.

### The convergence migration, which the proof demanded

A generated baseline is not automatically equivalent to 202 replayed migrations, so the two were
compared against a real Postgres 16: apply each to its own database, then diff a catalog fingerprint
of every column, constraint, index, enum and extension.

They matched on every count — 1226 columns, 473 constraints, 329 indexes, 69 enums, 3 extensions —
and were **three rows apart**. The foreign keys on `prior_gear_assignments` were `..._fk` on the
replayed path and `..._fkey` on the baseline: identical definitions, different names.

The legacy schema was the inconsistent one. All 266 foreign keys here are `_fkey`; those three were
`_fk` because `20260824090000_prior-gear-assignments` was hand-written and its author typed the
older convention. Harmless while replaying everything was the only route to the schema — and a real
divergence the moment a baseline exists, because a shop provisioned fresh would carry different
constraint names from a shop that upgraded into it. That is the exact condition
`src/db/migrations.postgres.test.ts` compares the two paths to catch.

So `20260904190000_converge-prior-gear-fk-names` renames the three, each guarded by `IF EXISTS` so
it is a no-op on the fresh path. Nothing in `src/` or `scripts/` names those constraints.

## Alternatives considered

**Exclude the snapshots from the deploy upload and delete the deploy-time guard** — issue #1343's
own proposal. Rejected on measurement: the 83 MB is uncompressed, and the snapshots are only
**3.29 MiB of the gzipped upload** (17.28 MiB → 14.00 MiB, measured by building both tarballs).
Worse, `.vercelignore` gates only the `vercel --prod --archive=tgz` CLI path that
`scripts/post-deploy-wizard.mjs` runs; ADR 20260718-vercel-hosting makes the Git integration the
routine production path, where the file does nothing at all. So it spends a real guard to save
~3 MiB on the deploy path that runs least often, and leaves the slope untouched.

**Exclude the snapshots but let the guard tolerate their absence under `VERCEL`.** Rejected
outright. It saves the same 3.29 MiB as the option above and adds a conditional whose only job is
to make a guard stop checking in the one environment where being wrong is most expensive. Issue
#1336 had just finished removing the *accidental* version of that behaviour.

**Leave it alone.** Defensible, and it was the standing position. What moved it was learning that
both stated blockers were false: the choice on the table had been "a big risky change versus a
small useless one", and it was actually "a well-understood change versus a small useless one".
Working-tree disk was never the argument — `drizzle/` cost only 0.28 MiB of the 28 MiB git object
store, because git deltas near-identical snapshots roughly 280:1.

**Rename the three foreign keys in the baseline to `_fk` instead of adding a convergence
migration.** Rejected: it would bake the hand-written anomaly into every fresh schema forever, and
the next `pnpm db:generate` would immediately want to rename them back, so the drift would return
with the next migration anyone writes.

## Consequences

- `drizzle/` is **83 MB → 1.3 MB**, and the per-migration slope is gone.
- `scripts/check-migration-graph.mjs`'s `KNOWN_UNSNAPSHOTTED` set is **empty**. Its one entry was
  that same hand-written folder, and the note beside it said backfilling its snapshot "means
  reconstructing the whole schema as of that commit, which is a change to migration history and a
  ticket of its own". This was that ticket.
- The commutativity walk still runs inside `scripts/vercel-build.mjs`. Squashing removed the reason
  anyone wanted to drop it (the upload cost), so the guard stays.
- **What this does not license.** The pre-pilot posture in AGENTS.md ("There is no legacy. Delete
  it.", H-49) is why rewriting migration history was affordable *once*, before any production
  database exists. It is not a licence to squash again casually: a second squash against a live
  Neon database is a different decision, and the name-reuse mechanism above is what it would have
  to be built on.

## Verification

Both paths were applied to a real Postgres 16 and their catalog fingerprints diffed: **zero
differing rows**. The upgrade run took 34 ms — the baseline skipped by name, only the convergence
migration executing, which is the mechanism demonstrating itself.

`pnpm test src/db/migrations.postgres` against that server: 2 passed, not skipped. Its second test
is the fresh-install-versus-previous-release comparison this ADR turns on. PGlite executes the
`DO $$` block too (`gear.test.ts` + `shops.test.ts`, 59 passed, including the exclusion constraint
carried by hand).
