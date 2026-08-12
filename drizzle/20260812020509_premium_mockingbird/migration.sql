ALTER TABLE "shops" ADD COLUMN "gear_setup_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "briefing_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "boat_ride_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "bottom_time_minutes" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "surface_interval_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_gear_setup_minutes_nonnegative" CHECK ("gear_setup_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_briefing_minutes_nonnegative" CHECK ("briefing_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_boat_ride_minutes_nonnegative" CHECK ("boat_ride_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_bottom_time_minutes_positive" CHECK ("bottom_time_minutes" > 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_surface_interval_minutes_nonnegative" CHECK ("surface_interval_minutes" >= 0);