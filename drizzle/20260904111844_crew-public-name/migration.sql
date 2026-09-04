-- The string a consenting crew member publishes to divers, stored rather than
-- derived from `full_name` at render time (issue #1351).
--
-- No backfill, deliberately. `crew_public_consent_at` has never been released --
-- it arrives in this same change set -- so the `where crew_public_consent_at is
-- not null` a backfill would carry matches zero rows in every database that
-- will ever run this. Writing one would be exactly the pre-pilot migration
-- AGENTS.md refuses under "There is no legacy. Delete it."
--
-- The constraint is what makes that safe instead of hopeful: a row that somehow
-- did carry a stamp with no name fails this migration outright, rather than
-- reaching `tripPublicCrew` and rendering a bullet with no name beside it, with
-- no error and no failing test. It reads through `nullif(btrim(...), '')` so
-- that an empty string counts as nothing to publish -- a bare null test would
-- admit exactly the row it is here to refuse. The one tree where this can fail
-- is a developer's own dev database seeded from an earlier commit of this
-- branch; `pnpm db:reset` is the answer there.
ALTER TABLE "people" ADD COLUMN "crew_public_name" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_crew_public_name_with_consent" CHECK (("crew_public_consent_at" is null) = (nullif(btrim("crew_public_name"), '') is null));