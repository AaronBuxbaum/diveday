CREATE TYPE "checkout_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "booking_checkout_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "checkout_status" DEFAULT 'pending'::"checkout_status" NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"checkout_url" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"amount_per_diver_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkout_bookings_checkout_booking_unique" ON "booking_checkout_bookings" ("checkout_id","booking_id");--> statement-breakpoint
CREATE INDEX "booking_checkout_bookings_booking_idx" ON "booking_checkout_bookings" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkouts_stripe_session_unique" ON "booking_checkouts" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_shop_trip_idx" ON "booking_checkouts" ("shop_id","trip_id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");