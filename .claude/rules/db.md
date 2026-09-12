---
paths:
  - "src/db/**"
  - "drizzle/**"
---

# Rules for `src/db/` and `drizzle/`

Loaded when a file under these paths is read. The universal rules stay in `AGENTS.md`; this file
carries the ones that only matter here, moved out so a session that never touches the database
never pays for them.

## Where things are

- **Schema** (source of truth — never read `drizzle/`): `src/db/schema.ts`. Locate a table with
  Grep and read the range; the file is 8,700 lines and the Read guard refuses it whole.
- **Client / test db factory**: `src/db/client.ts` (`getDb()`, `createTestDb()`).
- **Queries and seed data**: `src/db/shops.ts`, plus two barrels over sibling modules —
  `src/db/trips.ts` re-exports `trips-create/-series/-record/-schedule/-crew/-roster.ts`, and
  `src/db/seed.ts` orchestrates the `seed-*.ts` scenarios. Import from the barrel; edit the
  sibling.
- **Demo/seed data**: a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`'s
  orchestrator — never wedge rows into an existing scenario, which is how that file became the
  repo's top conflict magnet (ADR 20260803-seed-scenario-modules). Do **not** seed a failure state
  into blue-mantis (see the e2e rules: trouble states are seeded through
  `/api/test/seed-trouble-states`); `src/db/seed-front-desk.ts` says so at the row it deliberately
  seeds `succeeded`.
- **The booking transaction** (capacity enforcement): `src/db/bookings.ts` — read its tests first.
- **Staff seating a diver**: one consequence path, `src/db/seat-diver.ts` (booking + waiver-on-join
  + activity trail + analytics). Never re-implement the post-booking side effects at a call site.
- **Retention / pruning of append-only tables**: `src/lib/retention.ts` holds `RETENTION_DAYS` (the
  one table a human edits; the values are HD-11's call), `src/db/retention.ts` runs the bounded
  prune, `src/app/api/cron/retention/` is the weekly surface. The `stripe_webhook_events` window is
  asserted against Stripe's retry horizon, not merely commented.
- **Recurring trips**: materialization in `src/db/trips-series.ts`, cadence math in
  `src/lib/recurrence.ts`. A run has **no limit** (`trip_series.ends_on` null keeps going into a
  rolling `SERIES_HORIZON_DAYS` window). Every instance is an ordinary independent `trips` row — a
  deleted one leaves a `trip_series_skips` row so the roll never puts it back, and a moved one keeps
  its `series_occurrence_date` so the roll never re-fills the slot it left. **Narrowing a cadence
  cancels nothing** — orphaned dates are listed back with head counts and taken off only on a
  second tap (ADR 20260810-open-ended-recurring-trips).
- **Gear register**: opt-in **by presence** — zero `gear_items` rows means no gear UI anywhere
  (ADR 20260815-minimal-gear-register). The double-booking guard is the
  `gear_reservations_no_overlap` **exclusion constraint** (btree_gist, hand-added SQL in the
  migration, raced for real in `gear-reservations.postgres.test.ts`): catch 23P01 via
  `violatesExclusionConstraint`, never pre-check availability as truth. Service clocks are the
  newest `gear_service_events` row per kind and **inform, never gate**. `pnpm task:context gear`.
- **Buddy teams**: `src/db/buddy-pairs.ts` (named for its table, `buddy_pair_members`; every word a
  human reads says "team"). A team is two or more, a member is a booking **or** a crew person, and
  every act appends to `buddy_team_events` — informs, never gates (ADR 20260804-buddy-teams).
- **Starting content a shop copies and then owns**: `src/db/dive-site-templates.ts` and
  `src/db/course-templates.ts`, both `i18n-exempt-file` — picking one **copies** its words onto the
  shop's row, and nothing is read back at render, so a later correction never rewrites what a shop
  published. The **opposite** contract is `src/db/marine-life-catalog.ts`: 148 species as slug +
  Latin binomial + category code and no prose; DiveDay writes the words once in every language
  (`marineLife.*` in `diver.json`), and `MARINE_LIFE_CATALOG` is `as const`, so a species added
  without its copy is a **compile** error (ADR 20260813-marine-life-is-diveday-copy). A species
  DiveDay does not carry lands in `marine_life_requests` — a table nothing renders.
- **Course inquiries** (`course_inquiries`, `src/db/course-inquiries.ts`): `course_id` is nullable
  and the check constraint refuses a row naming neither a course nor an interest (ADR
  20260814-a-date-request-is-a-course-inquiry).
- **Integrations**: rows in `src/db/integrations.ts` (credentials sealed by `src/lib/secret-box.ts`)
  and `src/db/integration-events.ts` (the at-least-once outbox); OAuth state in
  `integration_oauth_states`, consumed once and bound to the shop **and** the person who started it.

## Changing the schema

Follow the **schema-change** skill. The short form: edit `src/db/schema.ts`, `pnpm db:generate`
with a `--name`, review the generated SQL once, seed if e2e needs rows, and **before you push** run
the four coverage guards that assert over `schema.ts` from files you will never touch:

```bash
pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot
```

Touching `schema.ts` at all is the trigger, not the shape of the change — `pnpm test:changed`
selects the whole suite after a schema edit, and that run belongs to CI
([docs/agents/verifying.md](../../docs/agents/verifying.md)). Never hand-edit or hand-merge
anything under `drizzle/`; a migration is generated, and a conflict there is resolved by reverting
your migration files, rebasing, and regenerating.

## There is no legacy. Delete it.

DiveDay is pre-pilot: no users, no data anyone would miss (H-49, extending H-47). A table nothing
writes gets **dropped**, not carried behind a `seq` column so its dead rows sort nicely. A code path
that exists only to tolerate old rows gets **deleted**, not documented. A lifecycle rule that exists
only to age out abandoned objects gets **removed**, not waited out. Do not write reconciliation,
backfill, dual-read, or version-tolerance code for pre-pilot data, and do not read the absence of
one as an oversight to fix — three follow-ups proposed exactly that in one week, and each was a
migration spent on rows that have never had a reader. When in doubt the answer is the smaller tree.

**Two things this does not relax**, because they are not about the value of the data: the
**destructive-migration guard** and the expand/contract rule keep the *previous release* alive
while a migration runs inside the production build, and having no users does not help a shop
watching its schedule mid-deploy — a destructive migration still carries its
`-- diveday:allow-destructive <rule> <table>.<column>: <why>` line, where "pre-pilot, no users,
H-49" is now a sufficient *why*. And **H-02's retention windows and the erasure path** are promises
about data we *will* hold; they stand. This rule expires the moment the first pilot shop has real
divers in the system — Aaron will say so, and it is not an agent's call to make.

## Every delete is soft, and the word on screen is still "Delete."

A user pointing at a thing and asking for it gone sets `deleted_at`; the row stays and history holds
(ADR 20260820-every-delete-is-soft, extending 20260719-crud-archive-semantics to every entity). This
is the default, not a list of blessed tables: a new table holding anything a user can delete gets
`deleted_at`, a partial index over the live rows only, and `deleted_at is null` in every
active-workspace read. The column is `deleted_at` — `archived_at` is not a second spelling of it.

**Never say so.** Not Archive, Unarchive, Deactivate, Retire, Hide, or "soft delete" in anything a
person reads — button, confirm, toast, notice, filter, empty state; a staff list of deleted records
is "Deleted" and its action is "Restore". No sentence explains which history survived: a caption
reassuring the reader about an outcome they never doubted earns nothing, and "archive" makes a shop
stop mid-afternoon to work out whether we mean the thing they asked for. The euphemism does not have
to be one of those words to be one: "Takes this diver off your active lists", under a heading saying
**Delete** and above a button saying **Delete Adaeze Nwosu**, was the only one of the three that
declined to say it (issue #779). `pnpm check:repo` refuses that family over the message bundles.

**A publish state is not a delete, and says so.** Hiding a review and taking a course off the public
site are both *unpublishing*: `tripReviews.isPublished` is reversible by republishing and a hidden
review still counts against the shop's suppression share (ADR
20260813-review-moderation-has-a-floor), and `courses.is_active` is the toggle on the "Live at
/s/<slug>/courses/<slug>" line — neither table has a delete at all. So "Hidden" is the honest word
in both, and the test is whether the thing is *gone* or merely *not shown*.

**Two exceptions.** *Legal erasure*, where an obligation requires real destruction — it stays
one-way, stays a separate column from `deleted_at` (`people.anonymized_at` plus its check
constraint), never becomes the primary action, and is the one place the distinction *is* expressed,
because the reader is choosing between two outcomes and one has no undo. And *machinery nobody
pointed at*: H-02's bounded retention prune, child rows rewritten wholesale when their parent saves
(`trip_dives`, `trip_schedule_days` — a replace), a single-use token consumed on use, seed and test
teardown. This does **not** touch the rule above it: "There is no legacy" governs the *tree*; this
one governs *rows at runtime*.

`deleteTrip` (`src/db/trips-schedule.ts`) stamps `trips.deleted_at` and leaves all five child tables
attached, and `scripts/check-live-trips.mjs` (in `pnpm check:repo`) fails the build on any read of
`trips`, or any join from a surviving child table, that neither carries `liveTrip()`
(`src/db/trips-live.ts`) nor says `diveday:allow-deleted-trips: <why>`. That gate exists because the
failure is silent and public: an unfiltered read shows an anonymous visitor a departure the shop
took off the board. `deleted_at` is the only spelling in the tree, internal names included.

A departure that *moves* has a second obligation: `trips.revision` is published as the RFC 5545
`SEQUENCE` (`src/lib/trip-calendar.ts`), so a write of `trips.starts_at` that leaves the revision
flat leaves every subscribed calendar on the old `DTSTART` (issue #1165).
`scripts/check-trip-revision.mjs` (also in `pnpm check:repo`) fails any `.update(trips)` writing
`startsAt` whose `.set()` neither bumps `revision` nor says `diveday:allow-flat-revision: <why>`
— the reason being required, and a `.set()` handed anything but an object literal being refused
rather than guessed at.

## Tenant isolation

Every domain table carries `shop_id`; every query filters by the session's shop; a lookup by id,
slug or token cannot return another shop's row. A change to rows holding personal or medical data,
to export/import, or to a token flow gets a `security-reviewer` review before merge.
