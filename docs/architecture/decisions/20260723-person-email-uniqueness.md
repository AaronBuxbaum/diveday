# 20260723-person-email-uniqueness — Enforce one active person per (shop, email)

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/assessments/codebase-review-20260723.md) (CR-008)
found that booking, wait-list, staff diver-creation, and CSV import all matched a person by
`(shop_id, email)` with a plain read-then-write: select for an existing active row, insert one if
none exists. Nothing in the database enforced uniqueness. Two concurrent writers for the same
email — a diver's own booking landing at the same moment a staffer imports their contact, or a
double-submitted booking form — could both pass the read under READ COMMITTED and both insert,
splitting one diver's certs, waivers, and rental history across two person rows with no way to
notice short of staff spotting a duplicate on the roster.

## Decision

- **A partial, case-insensitive unique index is the source of truth**, not application discipline
  alone: `people_shop_email_unique` on `(shop_id, lower(email))` `WHERE deleted_at IS NULL AND
  email IS NOT NULL` (`src/db/schema.ts`). Partial on the live rows only, matching the
  archive-not-delete pattern already used for certification identifiers
  (`certifications_shop_agency_identifier_unique`): a soft-deleted person's email frees up, and an
  undelete that would collide with a since-created active person is refused rather than silently
  merging two records.
- **One shared conflict-safe helper**, not four independent retrofits: `findOrCreatePerson`
  (`src/db/people.ts`) is now the single path every walk-in-identity write goes through
  (`src/db/bookings.ts`, `src/db/waitlist.ts`, `src/db/import.ts`). It still reads first (the
  common case never touches the constraint), but on an insert that loses the race, it catches the
  unique-violation and re-reads the winner instead of throwing — two concurrent calls for the same
  email always converge on one person, never a throw the caller has to handle.
- **`createDiver`/`updateDiver`/`restoreDiver` (`src/db/divers.ts`) keep their existing
  create-or-refuse contract** (return `null`/`false` on a collision) rather than switching to
  reuse: staff explicitly creating a new diver record, editing one's email, or undeleting one
  should see "that email is already on file," not have their action silently redirected onto a
  different person's record. Each now catches the same unique-violation as a graceful refusal
  instead of an unhandled throw.
- **A generic Postgres-error-shape check, not a query-specific one**: `isUniqueConstraintViolation`
  (`src/db/client.ts`) walks `.cause` chains looking for SQLSTATE `23505`, because drizzle-orm's
  `DrizzleQueryError` nests the real driver error under `.cause` rather than surfacing `.code`
  directly. Generic so any future unique constraint can reuse it without re-deriving the error
  shape.
- **Application-layer normalization stays**: every insertion path already did
  `.trim().toLowerCase()` before comparing/writing (an audit confirmed all four — booking,
  wait-list, staff diver creation, CSV import via `src/lib/import.ts`'s `prepare` step — were
  already consistent). The `lower(email)` index is defense-in-depth against a *future* write path
  that forgets to normalize, not a workaround for a currently-inconsistent one.

## Alternatives considered

- **Case-sensitive plain-column index, relying on the existing app-layer lowercasing** — cheaper to
  express (`onConflictDoNothing`'s typed `target` only accepts real columns, not `lower(email)`
  expressions, so this would have let the codebase keep using drizzle's typed upsert helper instead
  of a try/catch). Rejected: it protects nothing against a future write path that skips
  normalization, and the whole point of a database constraint over an application convention is
  that it doesn't depend on every future caller getting it right.
- **`onConflictDoNothing`/`onConflictDoUpdate` instead of catch-and-reread** — drizzle's typed
  insert-conflict API doesn't accept expression targets (only `IndexColumn | IndexColumn[]`), so it
  cannot target a `lower(email)` partial index. The catch-and-reread shape works identically
  regardless of the constraint's shape and needed writing once, in `findOrCreatePerson`.
- **Merge duplicates as part of the migration** — no production database exists yet for this app to
  carry pre-existing collisions, so there is nothing to merge. If this migration is ever applied to
  a database that already has case-insensitive email collisions among active people, it will fail
  to apply with a specific `23505` naming the offending `(shop_id, email)` pair; the migration
  operator can find every such pair in advance with:
  ```sql
  SELECT shop_id, lower(email), count(*)
  FROM people
  WHERE deleted_at IS NULL AND email IS NOT NULL
  GROUP BY shop_id, lower(email)
  HAVING count(*) > 1;
  ```
  and must reconcile each one by hand (merge or delete) before the migration can apply — this
  migration deliberately never auto-merges safety-relevant records (cert/waiver/rental history)
  on a shop owner's behalf.

## Consequences

- Two racing writers for the same email now always converge on one person row; the loser of the
  race pays one extra read, never a lost/duplicated identity.
- `createDiver`, `updateDiver`, and `restoreDiver` gained a defense-in-depth refusal path they
  didn't strictly need under single-writer conditions before, but that is now exercised any time
  their existing read-then-write check itself loses a race.
- **Escape hatch:** if a shop genuinely needs two active people who happen to share an email
  (rare — e.g. a shared family account), the constraint has no per-row override today; that would
  need a deliberate product decision (e.g. an opt-in "shared contact" flag) before being modeled,
  not a workaround baked into this migration.
- **Open safety question (H-13):** self-service `findOrCreatePerson` reuse matches on email only,
  never comparing the submitted name — a `dive-domain-expert` review flagged this as unsafe for a
  shared-inbox scenario (a spouse, or a minor booked under a parent's email) where a new diver's
  booking can silently inherit an existing person's verified cert and current waiver with no
  medical questionnaire or cert check ever collected for them. Whether that needs a name-mismatch
  safeguard before production is recorded as a human decision, not resolved by this ADR — see
  [H-13](../../product/human-decisions.md) and the
  [identity match key glossary entry](../../product/glossary.md#modeling-notes).
- **Concurrency-closing path is not exercisable in the current test suite:** the catch-and-reread
  branch in `findOrCreatePerson`/`createDiver`/`updateDiver`/`restoreDiver`/`commitContactImport`
  only fires under a genuine race between two open transactions, which PGlite's single-connection
  test database cannot produce (the same acknowledged limitation as `src/db/bookings.ts`'s row
  lock). The insert runs inside a nested transaction (a savepoint via drizzle's `tx.transaction()`)
  specifically so a losing race rolls back only its own insert rather than aborting the caller's
  whole enclosing transaction — verified by reading `drizzle-orm`'s session implementation, not by
  a test that can exercise real concurrent connections.
