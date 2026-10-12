ALTER TABLE "shops" ADD COLUMN "public_year_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_hours_confirmed_at" timestamp with time zone;