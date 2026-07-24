-- CR-018: back the leading-wildcard `ilike '%query%'` search in
-- src/db/search.ts and src/db/divers.ts with real trigram-similarity GIN
-- indexes instead of the full-scan they were doing under a comment that
-- claimed (incorrectly) they were already indexed. Standard Postgres
-- contrib extension — available on Neon and loaded explicitly for PGlite
-- (see src/db/client.ts).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "dive_sites_name_trgm_idx" ON "dive_sites" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_full_name_trgm_idx" ON "people" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_email_trgm_idx" ON "people" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone_trgm_idx" ON "people" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "trips_title_trgm_idx" ON "trips" USING gin ("title" gin_trgm_ops);
