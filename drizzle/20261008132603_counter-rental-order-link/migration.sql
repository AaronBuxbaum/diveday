ALTER TABLE "gear_reservations" ADD COLUMN "order_id" uuid;--> statement-breakpoint
CREATE INDEX "gear_reservations_order_idx" ON "gear_reservations" ("order_id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");