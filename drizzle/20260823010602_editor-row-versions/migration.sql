ALTER TABLE "courses" ADD COLUMN "row_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "row_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- **Already applied, and re-emitted by a quirk of the merge folder above it.**
--
-- `20260822133824_shop-units-confirmed` added this column. `pnpm db:merge` then
-- closed a two-head fork with `drizzle-kit generate --custom
-- --ignore-conflicts`, and that flag makes drizzle carry *one* head's snapshot
-- forward rather than the union of both -- so the merge snapshot lost this
-- column, and the next `db:generate` (this one) saw it as missing.
--
-- `IF NOT EXISTS` is what makes that harmless in both directions: on any
-- database that ran the migration chain in order the column is already there,
-- and on a fresh one it is added by the earlier migration moments before this
-- runs. Without it this statement is a hard failure inside the production
-- build. This migration's own snapshot carries the column, so the next
-- generate is clean; the tooling trap itself is issue #852.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "units_confirmed_at" timestamp with time zone;