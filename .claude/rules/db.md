---
paths:
  - "src/db/**"
  - "drizzle/**"
---

# Rules for `src/db/` and `drizzle/`

Each rule names what enforces it; the reasoning, incidents and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-db-rules).

## Where things are

- **Schema**: `src/db/schema.ts`, by Grep and range (the Read guard refuses it whole); never read
  `drizzle/`. **Client and test db**: `src/db/client.ts`.
- **Queries**: `src/db/shops.ts` and the barrels `src/db/trips.ts` and `src/db/seed.ts`; import
  from the barrel, edit the sibling.
- **Demo data** is a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`, never rows
  wedged into an existing scenario (ADR 20260803-seed-scenario-modules), and never a failure state
  in blue-mantis.
- **Bookings**: `src/db/bookings.ts`, tests first. **Seating a diver**: one consequence path,
  `src/db/seat-diver.ts`.
- **Retention**: `RETENTION_DAYS` in `src/lib/retention.ts`, the prune in `src/db/retention.ts`.
- **Recurring trips**: `src/db/trips-series.ts`; every instance is an ordinary `trips` row, a
  deleted one leaves a skip row, and narrowing a cadence cancels nothing
  (ADR 20260810-open-ended-recurring-trips).
- **Gear**: opt-in by presence; double booking is refused by the `gear_reservations_no_overlap`
  exclusion constraint (catch 23P01), never a pre-check; service clocks inform, never gate
  (ADR 20260815-minimal-gear-register).
- **Buddy teams**: `src/db/buddy-pairs.ts`; every act appends to `buddy_team_events`; informs,
  never gates (ADR 20260804-buddy-teams).
- **Templates are copied, then the shop's**: `src/db/dive-site-templates.ts`,
  `src/db/course-templates.ts`. **The catalog is DiveDay's words**: `src/db/marine-life-catalog.ts`,
  a species without copy fails to compile (ADR 20260813-marine-life-is-diveday-copy).
- **Course inquiries**: `src/db/course-inquiries.ts`; a row names a course or an interest
  (check constraint).
- **Integrations**: `src/db/integrations.ts` (sealed by `src/lib/secret-box.ts`) and the outbox
  `src/db/integration-events.ts`; OAuth state is single-use and bound to shop and person.

## Rules

- **Change the schema through the schema-change skill**: `pnpm db:generate --name`, then before
  you push run the four coverage guards by path:
  `pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot`
  ([verifying.md](../../docs/agents/verifying.md)). Never hand-edit `drizzle/`; regenerate.
- **There is no legacy**: drop what nothing writes, delete code that only tolerates old rows, write
  no backfill or dual-read for pre-pilot data (H-49). It does not relax the destructive-migration
  guard (`-- diveday:allow-destructive <rule> <table>.<column>: <why>`) or H-02's retention and
  erasure promises. It expires when Aaron says the first pilot shop has real divers.
- **Every delete is soft**: `deleted_at`, a partial index over live rows, `deleted_at is null` in
  every live read (ADR 20260820-every-delete-is-soft). On screen the word is still "Delete"
  (soft-delete-vocabulary guard); a publish toggle is "Hidden". The exceptions are legal erasure
  (`people.anonymized_at`) and machinery nobody pointed at.
- **Every read of `trips` carries `liveTrip()`** or says `diveday:allow-deleted-trips: <why>`:
  live-trip-read guard (`scripts/check-live-trips.mjs`).
- **A write of `trips.starts_at` bumps `revision`** or says `diveday:allow-flat-revision: <why>`:
  trip-revision guard (`scripts/check-trip-revision.mjs`, issue #1165).
- **Tenant isolation**: every domain table carries `shop_id` and every query filters by the
  session's shop; personal or medical data, export/import and token flows get a
  `security-reviewer` review.
