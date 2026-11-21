-- Converge a database built from the old 382-migration history onto the
-- baseline (issue #4853, ADR 20261121-one-baseline-migration).
--
-- Such a database skips the baseline by name and runs only this file. A
-- catalog comparison of the old history against the baseline found three
-- places where replaying the history had left something the schema no longer
-- describes. On a fresh database each statement below finds nothing and does
-- nothing; on production it lands the schema a fresh database gets, which is
-- what `src/db/migrations.postgres.test.ts` compares the two paths to prove.
--
-- 1. `shop_shore_alert_tokens`. The schema stopped declaring it on 2026-11-05
--    (#3721); its rows were deleted then and its DROP was deferred one release
--    so the release then serving could keep reading it. Nothing has named it
--    since, so this is that deferred drop.
-- diveday:allow-destructive drop-table shop_shore_alert_tokens: the schema stopped declaring it in #3721 three weeks ago, its rows were deleted then, and no serving release reads or writes it
DROP TABLE IF EXISTS "shop_shore_alert_tokens";--> statement-breakpoint
-- 2. `buddy_team_members` kept its old table's constraint names when it was
--    renamed from `buddy_pair_members` (20261102072414): the primary key, three
--    foreign keys and, on Postgres 18 and PGlite, the NOT NULL constraints. A
--    rename of a primary key renames its index too.
-- 3. `roll_call_events.status` became `effective_status` (20261112054612) and,
--    on Postgres 18 and PGlite, kept its NOT NULL constraint's old name.
--
-- Catalog-only renames. Nothing in `src/` or `scripts/` names any of these
-- constraints (checked), and the guard has no rule for a constraint rename.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"buddy_team_members"'::regclass
       AND conname LIKE 'buddy\_pair\_members\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE "buddy_team_members" RENAME CONSTRAINT %I TO %I',
      c.conname,
      'buddy_team_members_' || substr(c.conname, length('buddy_pair_members_') + 1)
    );
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"roll_call_events"'::regclass
       AND conname = 'roll_call_events_status_not_null'
  ) THEN
    ALTER TABLE "roll_call_events" RENAME CONSTRAINT "roll_call_events_status_not_null" TO "roll_call_events_effective_status_not_null";
  END IF;
END $$;
