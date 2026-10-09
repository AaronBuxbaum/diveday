ALTER TABLE "activity_events" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_opens_minute" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_closes_minute" integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "after_hours_ping" boolean;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "after_hours_pinged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "activity_events_shop_occurred_idx" ON "activity_events" ("shop_id","occurred_at","seq");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_desk_hours_in_day" CHECK ("desk_opens_minute" >= 0 and "desk_closes_minute" <= 1440
        and "desk_opens_minute" < "desk_closes_minute");