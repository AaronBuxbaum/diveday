ALTER TYPE "payment_event_operation" ADD VALUE 'package_consumed' BEFORE 'order_refunded';--> statement-breakpoint
ALTER TYPE "payment_event_operation" ADD VALUE 'package_released' BEFORE 'order_refunded';--> statement-breakpoint
-- diveday:allow-destructive drop-constraint dive_packages.dive_packages_validity_positive: replace rolling validity with the fixed valid_until date before package sales are live
ALTER TABLE "dive_packages" DROP CONSTRAINT "dive_packages_validity_positive";--> statement-breakpoint
DROP INDEX "dive_package_entitlements_booking_unique";--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD COLUMN "trip_cents" integer;--> statement-breakpoint
ALTER TABLE "dive_packages" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD COLUMN "package_id" uuid;--> statement-breakpoint
-- diveday:allow-destructive drop-column dive_packages.validity_days: replace unused pre-pilot duration storage with the fixed valid_until date
ALTER TABLE "dive_packages" DROP COLUMN "validity_days";--> statement-breakpoint
ALTER TABLE "dive_packages" ALTER COLUMN "scope" SET DEFAULT 'fun_dives'::"dive_package_scope";--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_booking_idx" ON "dive_package_entitlements" ("booking_id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_trip_cents_nonnegative" CHECK ("trip_cents" is null or "trip_cents" >= 0);
