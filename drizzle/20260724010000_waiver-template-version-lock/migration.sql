-- CR-015: a shop has exactly one waiver — saveWaiverTemplate already computes
-- the next version shop-wide with no title filter, so the unique constraint
-- now matches that real invariant instead of a looser (shop, title, version)
-- one that could let two different titles both claim "version 2" at the same
-- shop. No existing row can violate this: the app never allocated a version
-- number per-title, only per-shop.
DROP INDEX "waiver_templates_shop_title_version_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_templates_shop_version_unique" ON "waiver_templates" ("shop_id","version");
