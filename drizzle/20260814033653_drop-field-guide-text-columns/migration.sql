-- diveday:allow-destructive drop-column dive_site_creatures.name: the field guide is a catalog slug since ADR 20260813-marine-life-is-diveday-copy shipped; that release is live and no deployment reads this column
ALTER TABLE "dive_site_creatures" DROP COLUMN "name";--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_site_creatures.kind: the category word is DiveDay copy resolved per reader since ADR 20260813-marine-life-is-diveday-copy shipped; no live deployment reads this column
ALTER TABLE "dive_site_creatures" DROP COLUMN "kind";--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_site_creatures.image_url: a card's photo is DiveDay's own asset under public/marine-life since ADR 20260813-marine-life-is-diveday-copy shipped; no live deployment reads this column
ALTER TABLE "dive_site_creatures" DROP COLUMN "image_url";--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_site_creatures.description: the species sentence comes from the reader's own locale bundle since ADR 20260813-marine-life-is-diveday-copy shipped; no live deployment reads this column
ALTER TABLE "dive_site_creatures" DROP COLUMN "description";--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_site_creatures.preparation_tip: the "slow down" line comes from the locale bundle since ADR 20260813-marine-life-is-diveday-copy shipped; no live deployment reads this column
ALTER TABLE "dive_site_creatures" DROP COLUMN "preparation_tip";--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_sites.difficulty: replaced by the difficulty_level enum in ADR 20260813-dive-site-difficulty-is-a-code, which is live; every reader and the CSV export take the code
ALTER TABLE "dive_sites" DROP COLUMN "difficulty";
