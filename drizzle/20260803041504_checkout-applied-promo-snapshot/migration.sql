ALTER TABLE "booking_checkouts" ADD COLUMN "trip_promo_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "applied_discount_percent" integer;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_promo_id_trip_last_minute_promos_id_fkey" FOREIGN KEY ("trip_promo_id") REFERENCES "trip_last_minute_promos"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_applied_discount_range" CHECK ("applied_discount_percent" is null or "applied_discount_percent" between 1 and 100);--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_single_promo_source" CHECK ("promo_code_id" is null or "trip_promo_id" is null);