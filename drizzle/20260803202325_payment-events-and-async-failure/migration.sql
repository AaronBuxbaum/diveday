CREATE TYPE "payment_event_operation" AS ENUM('manual_mark', 'checkout_settled', 'order_settled', 'order_refunded', 'cancellation_refund');--> statement-breakpoint
CREATE TABLE "booking_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"previous_status" "payment_status",
	"amount_cents" integer,
	"currency" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"operation" "payment_event_operation" NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payment_events_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "async_payment_failed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "booking_payment_events_shop_booking_occurred_idx" ON "booking_payment_events" ("shop_id","booking_id","occurred_at");--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;