ALTER TABLE "gear_reservations" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "dives_logged" integer;--> statement-breakpoint
CREATE INDEX "gear_reservations_order_idx" ON "gear_reservations" ("order_id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_dives_logged" CHECK ("dives_logged" is null or ("dives_logged" >= 0 and "dives_logged" <= 200));