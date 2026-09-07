ALTER TABLE "shops" ADD COLUMN "fly_safe_hours_single" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "fly_safe_hours_repetitive" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_fly_safe_hours_in_range" CHECK ("fly_safe_hours_single" >= 12 and "fly_safe_hours_single" <= 72
        and "fly_safe_hours_repetitive" >= 18 and "fly_safe_hours_repetitive" <= 72
        and "fly_safe_hours_repetitive" >= "fly_safe_hours_single");