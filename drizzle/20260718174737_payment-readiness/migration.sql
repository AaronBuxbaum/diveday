CREATE TYPE "payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'waived', 'refunded');--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'unpaid'::"payment_status" NOT NULL,
	"amount_cents" integer,
	"currency" text DEFAULT 'usd' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD COLUMN "requires_payment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_booking_unique" ON "booking_payments" ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_payments_shop_status_idx" ON "booking_payments" ("shop_id","status");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");