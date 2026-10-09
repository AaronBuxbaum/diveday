ALTER TABLE "shops" ADD COLUMN "desk_opens_minute" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_closes_minute" integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "after_hours_ping" boolean;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "after_hours_pinged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_desk_hours_in_day" CHECK ("desk_opens_minute" >= 0 and "desk_closes_minute" <= 1440
        and "desk_opens_minute" < "desk_closes_minute");