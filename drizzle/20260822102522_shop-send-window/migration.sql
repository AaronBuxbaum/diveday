ALTER TABLE "shops" ADD COLUMN "send_window_start_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "send_window_end_hour" integer DEFAULT 20 NOT NULL;