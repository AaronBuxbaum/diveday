# 20260806-destructive-migration-guard — Refuse destructive DDL in a migration unless the SQL says why it is safe

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

`scripts/vercel-build.mjs` runs `pnpm db:migrate` **inside** the Vercel production build. Three
facts about that pipeline are individually documented and jointly the problem
(docs/engineering/deploy-and-migrations-runbook.md): there is no approval step between "schema
changed" and "code deployed", the previous release's code is still serving traffic while the
migration lands, and there are no down migrations anywhere in `drizzle/`. A `DROP COLUMN` merged
today therefore breaks production the instant it applies, and the only ways back are a forward
migration or branching Neon from a timestamp.

Expand/contract is the mitigation, and until now it was a rule a human followed with nothing behind
it. ADR 20260806-real-postgres-ci-job narrowed a *different* gap in the same pipeline — it proves a
migration **applies** cleanly on top of the previous release's schema. Applying cleanly is precisely
what a `DROP COLUMN` does. Nothing in the repo asked whether it *should*, and the 2026-08-02 review
recorded that as DATA-L5, noting it is the half of HD-19's problem that does not wait on HD-19.

The guard's first run found this was not hypothetical: an in-flight migration on this same branch
adds `courses.gallery_photos`, backfills it, and drops `image_urls`/`image_alts` — all in one
release, while the live deployment still reads both columns.

## Decision

Add `scripts/check-migrations.mjs`: it reads the SQL of every migration newer than the previous
release and refuses fourteen destructive statement shapes unless the migration file itself carries
an acknowledgement naming the statement and why the live deployment survives it. It is wired into
`pnpm check:repo` (so a branch fails locally and in CI) and into `scripts/vercel-build.mjs`
immediately before `pnpm db:migrate` (so the production build refuses before any DDL runs).

**What is refused.** `DROP TABLE`, `DROP SCHEMA`, `DROP TYPE`, `DROP EXTENSION`, `TRUNCATE`, a
`DELETE FROM` with no `WHERE`, `ALTER TABLE … DROP COLUMN`, `… DROP CONSTRAINT`, `… RENAME TO`,
`… RENAME COLUMN`, `… ALTER COLUMN … TYPE`, `… ALTER COLUMN … SET NOT NULL`,
`… ALTER COLUMN … DROP DEFAULT`, and `ALTER TYPE … RENAME`. Each is a line from the runbook's
"never in a single deploy (contract)" list, or a data-loss statement that list assumed nobody would
write by hand. Every failure names the *live code it breaks*, not the keyword, because that is the
sentence that tells an author whether to split the change or acknowledge it.

**Dropping a constraint counts as destructive.** This is the one judgement call worth recording. It
looks like merely "removing a check", and it is not: `ON CONFLICT (cols)` requires a matching unique
constraint or index and errors outright without one, so live upserts break the instant it lands; a
foreign key's `ON DELETE` behaviour is application semantics the code depends on; and rows written
while the constraint is gone can make re-adding it impossible, so it is not the cheaply-reversible
change it appears to be. Replacing a constraint in place is the legitimate case, and that is exactly
what the acknowledgement is for.

**`ALTER TYPE … ADD VALUE` passes**, along with `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`
(including `CONCURRENTLY`), `ADD CONSTRAINT … NOT VALID`, `VALIDATE CONSTRAINT`, `DROP NOT NULL`,
`SET DEFAULT`, and a `WHERE`-bounded backfill. The tests assert each of these explicitly, because a
guard that refuses the common safe case teaches its users to reach for the escape hatch reflexively,
and an escape hatch everyone uses without thinking is not one.

**The acknowledgement lives in the migration SQL, on its own comment line:**

```sql
-- diveday:allow-destructive drop-column people.full_name: release 4 of the rename; no instance has read it since #391
```

Six conditions make it unreachable by ordinary prose, which AGENTS.md requires of every guardrail
script here. The sentinel is a namespaced token rather than a phrase; it must open a line comment
the masker genuinely entered, so a `--` inside a multi-line string literal cannot act as one and a
sentence that merely *mentions* the sentinel never matches; the rule id must be one the guard knows,
and an unknown one is a failure rather than a silently-ignored line; every dot-separated part of the
target must appear in the flagged statement's own code — never in a comment above it — so one marker
cannot blanket a file; the reason must carry at least twenty characters; and a marker that excuses
nothing is itself a failure, so a copy-pasted or outlived one surfaces instead of quietly widening
the hatch. A line that opens with the sentinel but breaks the grammar is reported as malformed, not
ignored — a typo'd marker that silently did nothing would read, to its author, exactly like one that
worked.

**Which migrations are audited.** The previous release's folder set comes from
`scripts/previous-release-migrations.mjs` — the same "what is new on this branch" question the
real-Postgres suite asks, answered by the same module so the two can never disagree. Unlike that
suite, an unresolvable base commit is **not** a hard failure here: this guard runs in two
deliberately shallow checkouts (CI's `repo-safeguards` job takes `actions/checkout`'s default
`fetch-depth: 1`, and the Vercel build container is shallow too), and dying there would either take
`pnpm check` red on every run or invite someone to make the guard optional. The fallback is a
lexicographic watermark, `GRANDFATHERED_THROUGH`, naming the newest migration that predates the
guard. It audits *more*, not less — every post-watermark migration, forever — and it never needs
bumping, because a destructive migration that legitimately merges keeps passing on the evidence it
carries in its own file.

## Alternatives considered

- **An env-var override (`ALLOW_DESTRUCTIVE_MIGRATION=1`).** Rejected outright. The failure this
  guards is a rushed deploy, and a variable a rushed deploy can set is a guard a rushed deploy can
  turn off — with no record of which statement was consented to, by whom, or why. Putting the
  acknowledgement in the SQL puts it in the diff, in review, and in `git blame` beside the statement
  it excuses, forever.
- **A `--force` flag or a baseline JSON of excused migrations.** Same objection one step removed:
  both put the consent somewhere other than the statement, so review sees the flag and not the SQL.
- **A real SQL parser (`pg-query-parser`, `libpg_query`).** Rejected: a new native runtime dependency
  on a build-critical path, to make a cooperative guardrail marginally harder to fool. Every other
  guardrail script here is regex-level and says so.
- **Refusing `ADD CONSTRAINT … FOREIGN KEY` / `… UNIQUE` too.** The runbook does list "a UNIQUE or
  foreign-key constraint that existing rows might violate" as contracting. Rejected anyway: drizzle
  emits a separate `ADD CONSTRAINT … FOREIGN KEY` for every new table, so the rule would fire on
  essentially every additive migration in the repo. A guard that cries wolf is worse than no guard.
  Recorded here as a known gap rather than left to be rediscovered.
- **Refusing `DROP INDEX`.** Rejected on principle rather than on noise: the invariant is "cannot
  break the code that is live while the build runs", and a dropped index costs latency, not
  correctness.
- **A git-diff-based scan set with a hard failure on shallow clones** (matching
  `src/db/migrations.postgres.test.ts` exactly). Rejected: that suite runs in one job that sets
  `fetch-depth: 0`; this guard runs in `pnpm check:repo` and on Vercel, neither of which does.
- **Waiting for HD-19 / a staging environment.** That is the other half of the problem and it is a
  human decision with a cost attached. This half needs no CI spend and no ruling.
- **Doing nothing and keeping the runbook's rule.** The rule was correct and had been correct for a
  long time, which is the argument against leaving it as the only mitigation.

## Consequences

- **The expand/contract rule is now enforced, not merely written.** A contracting migration fails
  `pnpm check` on the branch that wrote it, and — if one ever reaches `main` unreviewed — the
  production build refuses before `db:migrate` opens a connection.
- **Deliberate contraction costs one comment line, and that line is the useful artifact.** It names
  the statement and the reason in the file a future incident will be read from, which is more than
  the previous mechanism (nothing) produced.
- **A new destructive shape is not covered until someone adds a rule.** `DROP VIEW`,
  `DROP FUNCTION`, `DROP TRIGGER`, and constraint additions are uncovered today, the first three
  because this schema has none. Adding one is a rule object and two test cases.
- **This is regex-level and cooperative, not a boundary.** Dynamically assembled DDL inside a
  `DO` block will pass. That is the same honesty every other guardrail script here carries, and it
  is stated in the script's own header so nobody reads the guard as a proof.
- **A dollar-quoted body is treated as code, not as a string.** The DDL this guard exists to see can
  legitimately live in a `DO $$ … $$` block — `drizzle/20260724000443_db-invariants-checks` really
  does — so a `$$…$$` used as a *string value* containing the word DROP would be a false positive.
  A false positive here is a conversation; a false negative is an outage.
- **The watermark is a one-time grandfathering line, not a ratchet to maintain.** Eight migrations
  already merged into `drizzle/` carry destructive statements; all eight predate the guard and are
  never audited. Nothing needs to be banked, absorbed, or re-baselined as migrations accumulate —
  unlike `copy-baseline.json` and its siblings, there is no file to write back to.
- **Revisit when** a real staging environment or a gated migration stage exists (HD-19), at which
  point the acknowledgement could become an approval rather than a comment; or when the false-positive
  rate on `drop-constraint` proves the call above wrong, which would be one rule object to delete.
- **No new dependency.** The guard is one file, standard library only, reusing
  `scripts/previous-release-migrations.mjs`.
