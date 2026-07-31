CREATE TYPE "depth_unit" AS ENUM('meters', 'feet');--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "max_depth_meters" double precision;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "depth_unit" "depth_unit" DEFAULT 'meters'::"depth_unit" NOT NULL;