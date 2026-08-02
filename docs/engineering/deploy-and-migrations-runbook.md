# Deploy and migrations runbook

How a merge to `main` reaches production, what the database does while that happens, and the one
rule — expand/contract — that keeps a bad migration from taking the app down. The pipeline is three
files: `vercel.json` (`"buildCommand": "node scripts/vercel-build.mjs"`, plus the daily cron entry),
`scripts/vercel-build.mjs` (18 lines), and `drizzle.config.prod.ts`
([ADR 20260718-vercel-neon-hosting](../architecture/decisions/20260718-vercel-neon-hosting.md)).
Restoring from a migration that has already destroyed data is a different document:
[backup-and-restore-runbook.md](backup-and-restore-runbook.md).

Read this before writing any migration. The **schema-change** skill covers how to author one;
this covers what happens to it after you merge.

## What actually happens on deploy

`scripts/vercel-build.mjs` in full, in prose: if `VERCEL_ENV === "production"`, run
`pnpm db:migrate`; then, always, run `pnpm build`. `pnpm db:migrate` is
`drizzle-kit migrate --config drizzle.config.prod.ts`, applying committed `drizzle/` SQL against
`DATABASE_URL_UNPOOLED` (Neon's direct connection — DDL over a transaction-mode pooler is
unreliable), falling back to `DATABASE_URL`.

Four consequences follow, and every one of them is load-bearing:

| Fact | Consequence |
| --- | --- |
| Migrations run **inside the build step**, not as a separate gated stage | There is no approval between "schema changed" and "code deployed", and no way to run one without the other |
| `pnpm db:migrate` can succeed and `pnpm build` can then fail | The database is left **migrated ahead of the live code**. The old deployment keeps serving, now against a newer schema. This is the normal failure mode, not an exotic one |
| Preview deploys skip migrations entirely (`VERCEL_ENV !== "production"`) | **There is no rehearsal surface.** A preview runs new code against the *old* production schema, or against nothing |
| CI never touches real Postgres — `.github/workflows/ci.yml` has no `services:` block and no `DATABASE_URL`; unit tests run on PGlite via `createTestDb()` | **The production deploy is the first time any migration executes against real Postgres.** PGlite is close to Postgres, not identical to it |
| `drizzle/` holds 63 forward-only migration folders (`migration.sql` + `snapshot.json`), with no down migrations anywhere | **Rollback is always forward.** There is no `drizzle-kit down`. "Revert the migration" is not a thing that exists here |

Put together: an unsafe migration is applied by the same command that builds the code, against a
database nothing has rehearsed against, with no way to reverse it. That is the blast radius.
Expand/contract is the mitigation that makes it survivable.

## The expand/contract rule

Follow this mechanically. It is not a style preference; it is what keeps the previous deployment
alive while the new one is still building, and what makes "roll the code back" a real option.

**The invariant:** at every instant during a deploy, both the old code and the new code must be able
to run against whatever the database currently looks like. The old code is live while the new build
runs, and it is what you fall back to when the new one is wrong.

### Safe in a single deploy (expand)

- Add a **nullable** column, or a column **with a default**.
- Add a new table.
- Add an index. On a table with meaningful row counts, write it `CREATE INDEX CONCURRENTLY` by hand
  — the default `CREATE INDEX` takes a lock that blocks writes for the duration.
- Add a new enum **value** (`ALTER TYPE ... ADD VALUE`). Note it cannot run inside a transaction
  block in older Postgres and cannot be removed later.
- Add a constraint as `NOT VALID`, then `VALIDATE CONSTRAINT` in a later migration.
- Backfill data, in batches, in its own migration.

### Never in a single deploy (contract)

Each of these breaks the currently-live code the instant it lands, before the new build has even
finished:

- Drop a column, or drop a table.
- Rename anything — a column, a table, an enum value.
- Change a column's type in a way that is not binary-coercible.
- Add `NOT NULL` to an existing column.
- Add a `UNIQUE` or foreign-key constraint that existing rows might violate.
- Remove an enum value.

### How a rename is split across releases

A rename is the canonical case. `people.full_name` → `people.display_name`, in four deploys:

| Release | Migration | Code |
| --- | --- | --- |
| 1 — expand | Add nullable `display_name` | Writes **both** columns; reads `full_name` |
| 2 — backfill | `UPDATE people SET display_name = full_name WHERE display_name IS NULL`, batched | Unchanged |
| 3 — switch | None | Reads `display_name`, still writes both |
| 4 — contract | Drop `full_name` (and add `NOT NULL` to `display_name` if wanted) | Stops writing `full_name` |

Releases 3 and 4 must not be merged together: release 4's drop has to land after every running
instance has stopped touching `full_name`, and "every running instance" includes the deployment that
was live thirty seconds ago. Leave at least one full deploy cycle between them, and confirm the
column is genuinely unreferenced (`rg full_name src/`) before dropping.

The same four-step shape covers a type change (add new column, backfill, switch reads, drop old)
and a NOT NULL tightening (backfill, add `CHECK ... NOT VALID`, validate, then set `NOT NULL`).

## Rollback

There are no down migrations. Rollback means one of two things, and choosing between them is the
first decision in any bad-deploy incident.

**Roll the code back, leave the schema.** Correct whenever the migration was expand-only — which,
if the rule above was followed, is every migration. Vercel dashboard → the project → **Deployments**
→ the last known-good deployment → **Instant Rollback**. It repoints the production alias at an
already-built deployment; it does not rebuild, and it therefore **does not run migrations of any
kind, forward or backward**. The database keeps the new column; the old code ignores it. This is why
expand-only migrations are the whole game — they are what makes the rollback button actually work.

**Write a forward migration that undoes it.** The only option when the bad migration was
contracting, or when it wrote wrong data. Generate a new migration that restores the shape, get it
reviewed like any other, and deploy it. It is a normal deploy, with all the same risks — expect it
to take as long as one.

**Restore the database.** When the migration destroyed data a forward migration cannot re-create —
a dropped column, a bad `UPDATE` without a `WHERE`. Go to
[backup-and-restore-runbook.md](backup-and-restore-runbook.md) §1 and branch Neon from a timestamp
before the deploy. This is the expensive path: everything written after that instant has to be
reconciled by hand.

### When the build failed after the migration succeeded

The specific hazard called out above. Symptoms: the deploy is red, but the schema has moved.

1. **Do not retry the deploy blindly.** `drizzle-kit migrate` is idempotent — it skips already-applied
   migrations — so a retry is safe from the *migration's* point of view, but it will not fix whatever
   broke the build.
2. **Check whether the live (old) deployment is still healthy.** If the migration was expand-only, it
   is: the new column is simply unused. Nothing is on fire; fix the build and merge again.
3. **If it is not healthy**, the migration was not expand-only, and you are in the "forward migration"
   or "restore" path above. Treat it as a Sev-1 per
   [incident-response-runbook.md](incident-response-runbook.md).

## Concurrent deploys

**Nothing serializes production deploys today.** Two merges to `main` in quick succession start two
Vercel production builds, and each one independently runs `pnpm db:migrate` against the same Neon
database. `drizzle-kit migrate` records applied migrations in its own tracking table, so the second
run will usually skip what the first already applied — but "usually" is doing real work in that
sentence, because there is no advisory lock spanning the two processes and their reads of that table
can interleave.

The repo's CI concurrency group (`ci-${{ github.ref }}`, `cancel-in-progress: true` in
`.github/workflows/ci.yml`) does not help here: it dedupes CI runs per ref, not Vercel builds, and
CI is not what applies migrations.

The posture, until something enforces it:

- **Merge one schema-changing PR to `main` at a time.** Wait for the production deploy to go green
  before merging the next. This is a rule for humans and agents, not a mechanism.
- **A PR containing a migration says so in its description**, so a second session can see it before
  merging on top (the **Parallel work** section of `AGENTS.md` already requires declaring expected
  schema changes).
- **Never merge two migrations that touch the same table in the same hour** without checking the
  first has landed.

If deploy frequency ever makes this a real collision risk, the fix is a Postgres advisory lock taken
around `pnpm db:migrate` in `scripts/vercel-build.mjs` — cheap to add, currently unnecessary, and
recorded here so the next person does not have to rediscover the problem.

## What this runbook does not cover

- **No staging environment exists.** Preview deploys do not migrate, so there is no environment where
  a migration runs before production does. Reviewing the SQL by hand and keeping it expand-only is
  the entire safety net.
- **No automated migration testing against real Postgres.** Unit tests run against PGlite, which
  differs from Neon in extension availability, some locking behaviour, and concurrency semantics. A
  migration that passes `pnpm check` has not been proven against production Postgres.
- **No schema drift detection.** Nothing checks that Neon's actual schema matches `src/db/schema.ts`.
  A hand-run statement in the Neon console would go unnoticed until a later migration failed.
- **Vercel's own rollback of *environment variables* is not covered** — Instant Rollback repoints
  code, and env-var changes are a separate, manual undo.

## When a deploy goes wrong

| Symptom | Look at |
| --- | --- |
| Deploy red, error in `pnpm db:migrate` | The migration never applied (drizzle-kit runs each file transactionally). Schema is unchanged; fix the SQL and re-merge. Read the Vercel build log, not the app logs |
| Deploy red, error in `pnpm build`, migration already ran | Schema is ahead of live code. Expand-only migration → harmless, fix the build. Contracting migration → the "build failed after migration" path above |
| App 500s immediately after a green deploy, errors mention a column | A contracting change shipped in one deploy, or old instances are still draining. Instant Rollback first, diagnose second — see [incident-response-runbook.md](incident-response-runbook.md) |
| Instant Rollback didn't fix it | The damage is in the database, not the code. Rollback does not touch the schema. Go to the forward-migration or restore path |
| Migration hangs and the build times out | A lock. `CREATE INDEX` without `CONCURRENTLY`, or `ALTER TABLE` behind a long-running transaction. Check active locks in the Neon console; the migration transaction is still open until the build is killed |
| A migration applied on Neon but is missing locally | Someone ran DDL by hand in the Neon console. Reconcile by writing the equivalent migration and confirming `drizzle-kit` treats it as applied — no drift check will catch this for you |
| Preview deploy behaves differently from production | Expected: previews never migrate (`VERCEL_ENV !== "production"` in `scripts/vercel-build.mjs`), so a preview runs new code against an unmigrated schema |
