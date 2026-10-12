ALTER TYPE "payment_event_operation" ADD VALUE 'refund_failed';--> statement-breakpoint
CREATE TABLE "stripe_refund_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_refund_id" text NOT NULL,
	"order_id" uuid,
	"checkout_id" uuid,
	"booking_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"refund_status" text NOT NULL,
	"failure_reason" text,
	"owed_until_refunded_cents" integer NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_refund_failures_amount_nonnegative" CHECK ("amount_cents" >= 0),
	CONSTRAINT "stripe_refund_failures_one_target" CHECK (("order_id" is null) <> ("checkout_id" is null)),
	CONSTRAINT "stripe_refund_failures_status" CHECK ("refund_status" in ('failed', 'canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_failures_refund_unique" ON "stripe_refund_failures" ("stripe_refund_id");--> statement-breakpoint
CREATE INDEX "stripe_refund_failures_shop_idx" ON "stripe_refund_failures" ("shop_id","failed_at");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");