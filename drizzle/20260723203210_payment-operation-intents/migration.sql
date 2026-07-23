CREATE TYPE "payment_operation_kind" AS ENUM('checkout_session', 'invoice', 'refund');--> statement-breakpoint
CREATE TYPE "payment_operation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "payment_operation_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "payment_operation_kind" NOT NULL,
	"status" "payment_operation_status" DEFAULT 'started'::"payment_operation_status" NOT NULL,
	"trip_id" uuid,
	"booking_id" uuid,
	"order_id" uuid,
	"checkout_id" uuid,
	"stripe_object_id" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pending_checkout_intent_id" uuid;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_shop_status_idx" ON "payment_operation_intents" ("shop_id","status");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");