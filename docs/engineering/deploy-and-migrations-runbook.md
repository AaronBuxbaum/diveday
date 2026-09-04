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
`node scripts/check-migrations.mjs`, then `node scripts/check-migration-graph.mjs`, then
`pnpm db:migrate`; then, always, run `pnpm build`.
`pnpm db:migrate` is `drizzle-kit migrate --config drizzle.config.prod.ts`, applying committed
`drizzle/` SQL against `DATABASE_URL_UNPOOLED` (Neon's direct connection — DDL over a
transaction-mode pooler is unreliable), falling back to `DATABASE_URL`.

Five consequences follow, and every one of them is load-bearing:

| Fact | Consequence |
| --- | --- |
| Migrations run **inside the build step**, not as a separate gated stage | There is no approval between "schema changed" and "code deployed", and no way to run one without the other |
| `pnpm db:migrate` can succeed and `pnpm build` can then fail | The database is left **migrated ahead of the live code**. The old deployment keeps serving, now against a newer schema. This is the normal failure mode, not an exotic one |
| Preview deploys skip migrations entirely (`VERCEL_ENV !== "production"`) | **There is no rehearsal surface.** A preview runs new code against the *old* production schema, or against nothing |
| CI rehearses migrations against a real Postgres before merge — the `real-postgres` job in `.github/workflows/ci.yml` (see [Rehearsal](#what-ci-rehearses-and-what-it-still-doesnt)) | **The deploy is no longer the first time the SQL meets a real server.** It is still the first time it meets *production data* |
| A destructive statement is refused before `db:migrate` runs — see [the guard](#the-guard-that-enforces-it) | **Expand/contract is enforced, not merely written.** The rule below is a mechanism now; what it does *not* cover is listed there |
| `drizzle/` holds a squashed baseline plus the forward-only folders added since (`migration.sql` + `snapshot.json` each), with no down migrations anywhere | **Rollback is always forward.** There is no `drizzle-kit down`. "Revert the migration" is not a thing that exists here. The baseline's folder *name* is load-bearing — see ADR 20260904-squash-migration-baseline before renaming it |

Put together: an unsafe migration is applied by the same command that builds the code, with no way to
reverse it. The SQL itself has been rehearsed; its interaction with real data volumes has not. That
is the blast radius. Expand/contract is the mitigation that makes it survivable.

## What CI rehearses, and what it still doesn't

The `real-postgres` job in `.github/workflows/ci.yml` runs the migrations against a genuine
Postgres 16 service container. It runs on any pull request touching `src/db/**`, `drizzle/**`, or the
harness itself, and nightly on `main` regardless — the nightly matters because what invalidates the
proof (a migration merged on another branch, a base image moving) arrives without touching your diff.

**What it proves.** Three things, and it is worth knowing which is which:

| Proof | Test | Catches |
| --- | --- | --- |
| Every migration applies to an **empty** database | `src/db/migrations.postgres.test.ts` | SQL that PGlite tolerates and Postgres does not. `CREATE EXTENSION pg_trgm` is the live example: a real statement in `drizzle/`, satisfied in PGlite by a wasm extension loaded in JavaScript before any migration runs |
| Today's migrations apply **on top of the previous release's schema** | same file | The only shape in which a *contracting* migration can fail. From empty there is nothing to drop, rename, or tighten, so a `DROP COLUMN` that breaks the running deployment applies perfectly cleanly. This is the expand/contract rule's own test |
| The two paths land on the **same schema** | same file | An upgrade path that has diverged from the fresh-install path — a shop provisioned tomorrow running a different schema from one that upgraded into it. Compared by reading `information_schema` and `pg_constraint`/`pg_indexes`, not by asking Drizzle whether its model is in sync |

The previous release's migration set is reconstructed by `scripts/previous-release-migrations.mjs`,
which streams the `drizzle/` tree at `git merge-base origin/main HEAD` out of the object store. It
checks nothing out and moves no ref, so it is safe in a working tree with other work in flight. A
clone too shallow to resolve a base commit is a **hard failure**, not a skip — hence `fetch-depth: 0`
on that job's checkout.

The same job also races the two locks that PGlite structurally cannot contend, since it is
single-connection: the oversell guard in `createBookingRecord` and the serialization in
`withBookingPaymentLock` (`src/db/bookings.postgres.test.ts`, `src/db/payments.postgres.test.ts`).

**What it does not prove.** Keep reviewing SQL by hand; this job narrows the gap, it does not close it.

- **Nothing about production data.** Every rehearsal runs against an empty or lightly-seeded
  database. The failures that scale with row count are exactly the ones still unrehearsed: a
  `CREATE INDEX` that locks writes for minutes, a batched backfill that times out the build, a
  `NOT NULL` that a real row violates. A migration that is green here can still take production down.
- **Nothing about Neon specifically.** The container is stock Postgres. Neon's pooler, its
  connection limits, and its cold-start behaviour are not in the picture — and the deploy applies DDL
  over `DATABASE_URL_UNPOOLED` for reasons this job never exercises.
- **Nothing about deploy sequencing.** It does not know that migrations run inside the build step, or
  that the old code is still live while they do. Expand/contract remains a rule you follow, not one
  that is enforced.
- **It is not a substitute for a staging environment.** There still isn't one.

To run it locally, see [testing.md](testing.md#running-the-real-postgres-suites-locally). The suites
skip cleanly with no server configured, so `pnpm check` is unaffected.

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

### Safe to land, unsafe to roll back into

A third category the two lists above have no slot for, because the hazard does not arrive at
migration time — it arrives days later, at the moment you press Instant Rollback.

- **Drop `NOT NULL` from an existing column.**

Landing it breaks nothing: every row that exists still has a value, so the live old code reads
exactly what it always read. The trap springs when the *new* code writes its first null and you then
roll the code back — the old deployment is now reading `null` out of a column its types say is a
`string`, and it does whatever an unguarded `.toLowerCase()` or `.trim()` does. Instant Rollback
does not touch the schema, so there is nothing to undo and no error to see coming; the previous
release simply starts throwing on rows it has never met.

The live instance of this: `20260815001735_gray_human_torch` drops `NOT NULL` from
`certifications.identifier` and `nitrox_certifications.identifier`, so a self-declared card can
exist without inventing a card number. Forward is provably safe — every writer in the *previous*
release sets a non-null identifier, so nothing it does can violate the new `CHECK`. Backward is not:
`src/db/import.ts` builds its dedupe map by calling `.toLowerCase()` on every live card's
identifier, so the first CSV import after a rollback 500s for the owner.

**Before Instant Rollback, ask whether the target release predates a nullability widening whose
nulls now exist.** If it does, the code rollback alone is not the safe path — you are in the
forward-migration or restore path below.

**Today there is a cheaper answer, and it has an expiry date.** DiveDay is pre-pilot with no real
users, so a database that has gone wrong can simply be reset and re-seeded rather than reconciled
(**H-47**). That makes this whole class of hazard a nuisance instead of an incident. It stops being
true the moment the first pilot shop has real divers in the system — at which point this section is
the plan, and the escape hatch is gone. Do not let that transition happen silently.

## The other thing that stops a deploy: two open migration heads

The guard below is about what a migration *says*. This one is about where it *sits*.

drizzle-kit 1.0 keeps a full `snapshot.json` in every migration folder, naming its parents in
`prevIds` — so `drizzle/` is a **directed graph**, not the linear chain the old `journal.json`
made it. A branch cut from `main` generates a migration whose `prevIds` point at main's head *at
that moment*. Two sessions each adding a migration, each merging cleanly with no git conflict
anywhere, therefore leave the graph with **two open heads**.

`drizzle-kit migrate` walks that graph before applying anything, comparing the branches below every
fork. Two heads touching different tables pass silently. Two heads touching the same object — two
new columns on `shops`, which happens here most weeks — are refused, *inside the production build*,
after the change is already on `main`. That is not hypothetical: it is how this section came to
exist, on 2026-08-22, when a deploy died at 11:58 printing a tree diagram and nothing else.

**The fix is `pnpm db:merge`, and it rewrites nothing.** It writes one migration folder whose SQL is
empty and whose snapshot names every open head as a parent; a fork whose branches reach a common
leaf is skipped by the walk entirely. `drizzle/20260822212616_merge-migration-heads` is the worked
example. The one case where it is the wrong answer is when the two branches genuinely add the same
column — then the merge folder quiets the check and the second `ADD COLUMN` still fails against a
real server, which the `real-postgres` job is what catches.

`scripts/check-migration-graph.mjs` runs the identical walk in two earlier places: `pnpm check:repo`
(so `repo-safeguards`, which checks out the *merge* ref on a pull request, sees the graph the merge
would produce rather than the one the branch has alone) and `scripts/vercel-build.mjs` immediately
before `pnpm db:migrate`, where its only job is to print the remedy the bare drizzle failure does
not. It opens no database connection.

### The guard that enforces it

`scripts/check-migrations.mjs` reads the SQL of every migration newer than the previous release and
refuses the contracting statements above. It runs in two places: `pnpm check:repo` (so a branch fails
locally and in CI, before anything is merged) and `scripts/vercel-build.mjs` immediately before
`pnpm db:migrate` (so a production build refuses before any DDL touches Neon). See
[ADR 20260806-destructive-migration-guard](../architecture/decisions/20260806-destructive-migration-guard.md).

**Refused** — fourteen shapes, each named by a rule id you will see in the failure:

| Rule id | Statement |
| --- | --- |
| `drop-table`, `drop-schema`, `drop-type`, `drop-extension` | `DROP TABLE` / `SCHEMA` / `TYPE` / `EXTENSION` |
| `truncate`, `delete-without-where` | `TRUNCATE`, and a `DELETE FROM` with no `WHERE` |
| `drop-column`, `drop-constraint` | `ALTER TABLE … DROP COLUMN` / `DROP CONSTRAINT` |
| `rename-table`, `rename-column`, `rename-type` | `ALTER TABLE … RENAME TO` / `RENAME COLUMN`, `ALTER TYPE … RENAME` |
| `alter-column-type`, `set-not-null`, `drop-default` | `ALTER TABLE … ALTER COLUMN …` `TYPE` / `SET NOT NULL` / `DROP DEFAULT` |

**Allowed**, and asserted to stay allowed by `scripts/check-migrations.test.mjs`: `CREATE TABLE`,
`ADD COLUMN` (including `NOT NULL DEFAULT` inline), `CREATE INDEX` and `CREATE INDEX CONCURRENTLY`,
`DROP INDEX`, `ALTER TYPE … ADD VALUE`, `CREATE TYPE … AS ENUM`, `ADD CONSTRAINT … NOT VALID`,
`VALIDATE CONSTRAINT`, `ADD CONSTRAINT … FOREIGN KEY`, `DROP NOT NULL`, `SET DEFAULT`, and a
`WHERE`-bounded `UPDATE` backfill. In other words: everything in the expand list above.

**Not covered.** `DROP VIEW` / `DROP FUNCTION` / `DROP TRIGGER` (this schema has none), and the
constraint *additions* in the contract list — drizzle emits an `ADD CONSTRAINT … FOREIGN KEY` for
every new table, so a rule there would fire on nearly every additive migration and train everyone to
wave the guard through. Those two lines of the contract list are still yours to follow by hand. The
guard is regex-level and cooperative, not a boundary; dynamically assembled DDL will pass it.

**When a statement genuinely cannot break the live deployment**, say so in the migration SQL itself,
on its own comment line — never with an environment variable, because the deploy this guards is the
rushed one:

```sql
-- diveday:allow-destructive drop-column people.full_name: release 4 of the rename; no instance has read it since #391
ALTER TABLE "people" DROP COLUMN "full_name";
```

The rule id must be one from the table, the target's every dot-separated part must appear in the
statement it excuses (so one marker cannot cover a file), and the reason must be at least twenty
characters. A marker that excuses nothing, names an unknown rule, or breaks the grammar is itself a
failure — silence there would read exactly like consent.

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

**Roll the code back, leave the schema.** Correct whenever the migration was expand-only *and* the
old code can read every row the new code has written since. Vercel dashboard → the project →
**Deployments** → the last known-good deployment → **Instant Rollback**. It repoints the production
alias at an already-built deployment; it does not rebuild, and it therefore **does not run
migrations of any kind, forward or backward**. The database keeps the new column; the old code
ignores it. This is why expand-only migrations are the whole game — they are what makes the rollback
button actually work.

The second half of that condition is the one that bites, because the schema alone will not tell you
it is false: a migration that only *widened* something is still expand-only, yet the rows the new
code wrote through that widening can be unreadable to the old code. See
[Safe to land, unsafe to roll back into](#safe-to-land-unsafe-to-roll-back-into) before choosing
this path — and note the pre-pilot escape hatch recorded there (**H-47**), which is why this is
currently a nuisance rather than an incident.

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

The repo's CI concurrency group in `.github/workflows/ci.yml` does not help here: it dedupes CI runs
(per ref for a pull request, which it cancels; per commit for a push to `main`, which it never
does), not Vercel builds, and CI is not what applies migrations.

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
  a migration runs before production does. The destructive-DDL guard refuses the *shapes* that break
  a live deployment; reviewing the SQL by hand is still what catches everything else.
- **No migration testing against realistic data volumes.** The `real-postgres` job proves the SQL
  applies — from empty and from the previous release — but only ever to an empty database. Lock
  duration, backfill runtime, and constraints that existing rows violate are all still discovered in
  production. `pnpm check` alone proves even less: it runs on PGlite, which differs from Neon in
  extension availability, some locking behaviour, and concurrency semantics.
- **No schema drift detection.** Nothing checks that Neon's actual schema matches `src/db/schema.ts`.
  A hand-run statement in the Neon console would go unnoticed until a later migration failed.
- **Vercel's own rollback of *environment variables* is not covered** — Instant Rollback repoints
  code, and env-var changes are a separate, manual undo.

## When a deploy goes wrong

| Symptom | Look at |
| --- | --- |
| Deploy red, "Destructive migration statements", before `db:migrate` | The guard refused. **Nothing ran** — the schema is untouched and the previous deployment is unaffected. Split the change across releases per [the guard](#the-guard-that-enforces-it), or acknowledge the statement in the SQL. This should have been caught by `pnpm check:repo` on the branch |
| Deploy red, error in `pnpm db:migrate` | The migration never applied (drizzle-kit runs each file transactionally). Schema is unchanged; fix the SQL and re-merge. Read the Vercel build log, not the app logs |
| Deploy red, error in `pnpm build`, migration already ran | Schema is ahead of live code. Expand-only migration → harmless, fix the build. Contracting migration → the "build failed after migration" path above |
| App 500s immediately after a green deploy, errors mention a column | A contracting change shipped in one deploy, or old instances are still draining. Instant Rollback first, diagnose second — see [incident-response-runbook.md](incident-response-runbook.md) |
| Instant Rollback didn't fix it | The damage is in the database, not the code. Rollback does not touch the schema. Go to the forward-migration or restore path |
| Migration hangs and the build times out | A lock. `CREATE INDEX` without `CONCURRENTLY`, or `ALTER TABLE` behind a long-running transaction. Check active locks in the Neon console; the migration transaction is still open until the build is killed |
| A migration applied on Neon but is missing locally | Someone ran DDL by hand in the Neon console. Reconcile by writing the equivalent migration and confirming `drizzle-kit` treats it as applied — no drift check will catch this for you |
| Preview deploy behaves differently from production | Expected: previews never migrate (`VERCEL_ENV !== "production"` in `scripts/vercel-build.mjs`), so a preview runs new code against an unmigrated schema |
