ALTER TABLE "activity_events" ADD COLUMN "order_id" uuid;--> statement-breakpoint
CREATE INDEX "activity_events_shop_occurred_idx" ON "activity_events" ("shop_id","occurred_at","seq");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;