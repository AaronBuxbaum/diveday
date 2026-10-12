CREATE TYPE "trip_blowout_cause" AS ENUM('weather', 'run_ended');--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "reopens_on" text;--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD COLUMN "cause" "trip_blowout_cause" DEFAULT 'weather'::"trip_blowout_cause" NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_series" ADD COLUMN "standing_crew" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_reopens_on_is_a_date" CHECK ("reopens_on" is null or "reopens_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');