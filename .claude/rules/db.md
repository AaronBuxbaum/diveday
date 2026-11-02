---
paths:
  - "src/db/**"
  - "drizzle/**"
---

# Rules for `src/db/` and `drizzle/`

Each rule names what enforces it; the reasoning, incidents and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-db-rules).

## Where things are

AGENTS.md and [the route map](../../docs/agents/route-map.md) say where (schema, queries and
barrels, bookings, seating, retention, integrations). What they do not say:

- **Demo data** is a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`, never rows
  wedged into an existing scenario (ADR 20260803-seed-scenario-modules), and never a failure state
  in blue-mantis. Seed crew goes into `trip_assignments` with direct inserts, not through
  `setTripCrew`: that writer accepted every seeded crew unchanged, but it also queues crew notices
  and manifest pushes that a fixture should not hold. Instead, `seed-trips.test.ts` replays every
  seeded roster through `setTripCrew` and expects each one to be accepted (issue #1813).
- **Recurring trips**: every instance is an ordinary `trips` row, a deleted one leaves a skip row,
  and narrowing a cadence cancels nothing (ADR 20260810-open-ended-recurring-trips).
- **Gear**: opt-in by presence; double booking is refused by the `gear_reservations_no_overlap`
  exclusion constraint (catch 23P01), never a pre-check; service clocks inform, never gate,
  except a counter rental of life support (ADR 20260815-minimal-gear-register, amendment
  2026-10-08).
- **Buddy teams**: every act appends to `buddy_team_events`; informs, never gates
  (ADR 20260804-buddy-teams).
- **Templates are copied, then the shop's; the catalog is DiveDay's words**: a species without
  copy fails to compile (ADR 20260813-marine-life-is-diveday-copy).
- **Date interests** (`interests`, `scope = 'date'`): a row names a course or an interest
  (`interests_scope_columns`) and never creates a person (H-20260724-one-person-per-email).
- **Integrations** are sealed by `src/lib/secret-box.ts`; OAuth state is single-use and bound to
  shop and person.

## Two kinds of module

- **A table module** (`src/db/<table>.ts`) holds a table's rows and the transitions on them, named
  by the transition (`record`, `mark`, `issue`, `claim`, `release`, `consume`, `restore`,
  `cancel`), never `update` or `save`.
- **A surface reader** (`src/db/<surface>.ts`, e.g. `today.ts`, `closeout.ts`) answers one page's
  question in one call. It detects nothing of its own (a rule lives in `src/lib`, once) and returns
  codes and data, not a sentence: `src/db` may not value-import `@/i18n/messages` or
  `@/i18n/staff-messages`, and `src/lib` may not value-import `drizzle-orm` (`scripts/check-architecture.mjs`
  seams; files that still do are banked in `scripts/ratchets.json`, and a new one fails). A
  page that needs a rule from Today's queue takes the small file below it (`src/lib/today-kinds.ts`,
  `today-urgency.ts`), not the queue.

## Rules

- **Change the schema through the schema-change skill**: `pnpm db:generate --name`, then before
  you push run the four coverage guards by path (the **verify** skill's checklist, step 3). Never
  hand-edit `drizzle/`; regenerate.
- **A column that defaults to now uses `appNowTimestamp`** (`src/db/schema/columns.ts`): the
  database default stays for raw SQL and a Drizzle insert takes the app clock, so a row made under a
  pinned `DIVEDAY_CLOCK` carries it; `schema-clock-default.test.ts` refuses a bare `.defaultNow()`.
  A test that reads "the latest" calls `advanceClock` (`src/test/clock.ts`) between writes.
- **There is no legacy**: drop what nothing writes, delete code that only tolerates old rows, write
  no backfill or dual-read for pre-pilot data (H-20260815-no-legacy). It does not relax the destructive-migration
  guard (`-- diveday:allow-destructive <rule> <table>.<column>: <why>`) or H-20260730-evidence-retention-period-deletion's retention and
  erasure promises, and it never justifies dropping a column a serving release still reads: remove
  the schema declaration in one release, drop the column in the next (the guard refuses a
  `drop-column` marker while the previous release or this branch still declares it). It expires when Aaron says the first pilot shop has real divers.
- **Every delete is soft**: `deleted_at`, a partial index over live rows, `deleted_at is null` in
  every live read (ADR 20260820-every-delete-is-soft). On screen the word is still "Delete"
  (the `softDelete` lint rule); a publish toggle is "Hidden". The exceptions are legal erasure
  (`people.anonymized_at`) and machinery nobody pointed at.
- **Every read of `trips` carries `liveTrip()`** or says `diveday:allow-deleted-trips: <why>`:
  live-trip-read guard (`scripts/check-live-trips.mjs`).
- **A write of `trips.starts_at` bumps `revision`** or says `diveday:allow-flat-revision: <why>`:
  trip-revision guard (`scripts/check-trip-revision.mjs`, issue #1165).
- **A db test runs on a real database**: mock the framework edge (`next/*`, the session, provider
  HTTP via `src/test/fakes.ts`), never `@/db/*`; a lock or race guard gets a `*.postgres.test.ts`
  ([testing.md](../../docs/engineering/testing.md#what-each-layer-is-for)).
- **A column that references `people` gets one row in `src/db/person-columns.ts`**: its kind and
  what a merge does with it; `person-columns.test.ts` fails with the column's name until it has one
  (issue #2724). **A person is minted only by `createPerson`** (`src/db/people.ts`), which writes
  `people.origin` and the roles: person-door guard (`scripts/check-person-door.mjs`, issue #2726).
  **A reader of `bookings.status` says `seatHeld` or `seatNotCancelled`**, never a hand-typed
  `ne(..., "cancelled")`: seat-status guard (`scripts/check-seat-status.mjs`, issue #2758).
- **Tenant isolation**: every domain table carries `shop_id` and every query filters by the
  session's shop; personal or medical data, export/import and token flows get a
  `security-reviewer` review.
