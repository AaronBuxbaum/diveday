-- Converge the three `prior_gear_assignments` foreign-key names.
--
-- Every other foreign key in this schema is named `<table>_<col>_<ref>_<refcol>_fkey`
-- — 263 of them, all emitted by `drizzle-kit generate`. These three were
-- `..._fk` instead, because `20260824090000_prior-gear-assignments` was
-- hand-written (it is the one folder `scripts/check-migration-graph.mjs` names
-- as carrying SQL with no snapshot) and its author typed the older convention.
--
-- That anomaly did not matter while the schema was only ever reached by
-- replaying all 202 migrations. Once the baseline replaced them, it did: a
-- database created fresh from the baseline gets `_fkey`, and a database that
-- had already run the hand-written migration keeps `_fk`. Two shops on
-- structurally different schemas is exactly what
-- `src/db/migrations.postgres.test.ts` compares the two paths to prevent.
--
-- Guarded rather than bare, because this file runs on both paths: on a fresh
-- database the baseline already created `_fkey` and there is nothing to rename,
-- so each block is a no-op. A constraint rename is catalog-only — no table
-- rewrite, no lock beyond ACCESS EXCLUSIVE for the statement, and nothing in
-- `src/` or `scripts/` refers to these names (checked).
--
-- No `diveday:allow-destructive` acknowledgement: `scripts/check-migrations.mjs`
-- has no rule matching a constraint rename, and `rename-column`'s pattern wants
-- an identifier immediately before `TO`, which `RENAME CONSTRAINT "x" TO "y"`
-- does not give it. The guard passes this file on its own. That gap is real —
-- a rename *can* break a live deployment when code names the constraint, as
-- `ON CONFLICT ON CONSTRAINT` does — but it is not this migration's to close.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prior_gear_assignments_shop_id_shops_id_fk') THEN
    ALTER TABLE "prior_gear_assignments" RENAME CONSTRAINT "prior_gear_assignments_shop_id_shops_id_fk" TO "prior_gear_assignments_shop_id_shops_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prior_gear_assignments_person_id_people_id_fk') THEN
    ALTER TABLE "prior_gear_assignments" RENAME CONSTRAINT "prior_gear_assignments_person_id_people_id_fk" TO "prior_gear_assignments_person_id_people_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prior_gear_assignments_gear_item_id_gear_items_id_fk') THEN
    ALTER TABLE "prior_gear_assignments" RENAME CONSTRAINT "prior_gear_assignments_gear_item_id_gear_items_id_fk" TO "prior_gear_assignments_gear_item_id_gear_items_id_fkey";
  END IF;
END $$;
