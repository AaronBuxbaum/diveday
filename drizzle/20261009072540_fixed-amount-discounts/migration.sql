ALTER TABLE "trip_last_minute_promos" ADD COLUMN "discount_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "applied_discount_cents" integer;--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD COLUMN "discount_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ALTER COLUMN "discount_percent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ALTER COLUMN "discount_percent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_discount_amount_positive" CHECK ("discount_amount_cents" is null or "discount_amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_one_discount" CHECK (("discount_percent" is null) <> ("discount_amount_cents" is null));--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_applied_discount_cents_positive" CHECK ("applied_discount_cents" is null or "applied_discount_cents" > 0);--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_single_discount_snapshot" CHECK ("applied_discount_percent" is null or "applied_discount_cents" is null);--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_discount_amount_positive" CHECK ("discount_amount_cents" is null or "discount_amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_one_discount" CHECK (("discount_percent" is null) <> ("discount_amount_cents" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint trip_last_minute_promos.trip_last_minute_promos_discount_range: the previous release always writes a discount_percent inside the old range and never writes discount_amount_cents, so every row it writes passes the widened check, and the drop and add are one atomic ALTER with no window between them
ALTER TABLE "trip_last_minute_promos" DROP CONSTRAINT "trip_last_minute_promos_discount_range", ADD CONSTRAINT "trip_last_minute_promos_discount_range" CHECK ("discount_percent" is null or "discount_percent" between 5 and 90);--> statement-breakpoint
-- diveday:allow-destructive drop-constraint shop_promo_codes.shop_promo_codes_discount_range: the previous release always writes a discount_percent inside the old range and never writes discount_amount_cents, so every row it writes passes the widened check, and the drop and add are one atomic ALTER with no window between them
ALTER TABLE "shop_promo_codes" DROP CONSTRAINT "shop_promo_codes_discount_range", ADD CONSTRAINT "shop_promo_codes_discount_range" CHECK ("discount_percent" is null or "discount_percent" between 1 and 100);