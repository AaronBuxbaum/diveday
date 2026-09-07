CREATE TYPE "dive_site_tide_preference" AS ENUM('any', 'slack', 'flood', 'ebb');--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "tide_station_id" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "tide_preference" "dive_site_tide_preference" DEFAULT 'any'::"dive_site_tide_preference" NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "tide_window_public" boolean DEFAULT false NOT NULL;