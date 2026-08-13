CREATE TYPE "dive_site_fit_tone" AS ENUM('welcoming', 'demanding', 'unknown');--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD COLUMN "catalog_slug" text;--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "fit_tone" "dive_site_fit_tone";--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "fit_note" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "field_guide_tips_heading" text;