ALTER TABLE "shops" ADD COLUMN "season_start_month" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "season_start_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_season_start_month_in_range" CHECK ("season_start_month" >= 1 and "season_start_month" <= 12);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_season_start_day_in_month" CHECK ("season_start_day" >= 1 and "season_start_day" <= 31
        and not ("season_start_month" = 2 and "season_start_day" > 28)
        and not ("season_start_month" in (4, 6, 9, 11) and "season_start_day" > 30));