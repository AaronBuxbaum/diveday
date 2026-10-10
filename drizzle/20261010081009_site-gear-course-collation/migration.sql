-- Give the three other text columns this app orders lists by the ICU collation
-- `people.full_name` carries (`20260911200158_person-name-collation`, H-81):
-- `dive_sites.name` (the site library and every site picker),
-- `gear_items.label` (the gear register) and `courses.title` (the course roster
-- and the public course list). Until now they sorted by the database default —
-- `C` (byte order) on PGlite, whatever initdb was handed on a server — so a
-- shop's "Ángel Reef" fell to the bottom of its library under "Zoe Wall" in the
-- suite and somewhere else in production. drizzle-orm's pg-core cannot express
-- a collation, so these statements are the source of truth; `drizzle-kit` only
-- *reports* a collation delta and will not regenerate it away.
--
-- What does not move, exactly as for `people.full_name`: `und-x-icu` is
-- deterministic, so `=` and the per-shop unique indexes on these columns
-- (`dive_sites_shop_name_unique`, `gear_items_shop_label_unique`,
-- `courses_shop_title_unique`) stay byte equality. What moves is case folding
-- for `lower()` and `ILIKE` on a `C`-collation server (the full Unicode range,
-- not ASCII alone) — case, never accents. `src/db/name-collation.test.ts` pins
-- both halves for all four columns.
--
-- Not `pg_unicode_fast`: PGlite has it and Postgres 16 does not, which would
-- put the suite and production back on different answers.
-- diveday:allow-destructive alter-column-type dive_sites.name: text -> text is binary-coercible, so no row is rewritten and the table keeps its files; the collation change rebuilds `dive_sites_shop_name_unique`, `dive_sites_shop_name_idx` and the GIN `dive_sites_name_trgm_idx` inside the ACCESS EXCLUSIVE lock, which is safe to land in the build step only because `dive_sites` holds no production rows yet (pre-pilot, H-49) — against a live table this wants a `lock_timeout` and a quiet window.
ALTER TABLE "dive_sites" ALTER COLUMN "name" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
-- diveday:allow-destructive alter-column-type gear_items.label: text -> text is binary-coercible, so no row is rewritten and the table keeps its files; the collation change rebuilds `gear_items_shop_label_unique` and the GIN `gear_items_label_trgm_idx` inside the ACCESS EXCLUSIVE lock, which is safe to land in the build step only because `gear_items` holds no production rows yet (pre-pilot, H-49) — against a live table this wants a `lock_timeout` and a quiet window.
ALTER TABLE "gear_items" ALTER COLUMN "label" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
-- diveday:allow-destructive alter-column-type courses.title: text -> text is binary-coercible, so no row is rewritten and the table keeps its files; the collation change rebuilds `courses_shop_title_unique` and the GIN `courses_title_trgm_idx` inside the ACCESS EXCLUSIVE lock, which is safe to land in the build step only because `courses` holds no production rows yet (pre-pilot, H-49) — against a live table this wants a `lock_timeout` and a quiet window.
ALTER TABLE "courses" ALTER COLUMN "title" SET DATA TYPE text COLLATE "und-x-icu";
