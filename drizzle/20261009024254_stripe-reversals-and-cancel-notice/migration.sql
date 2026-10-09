ALTER TYPE "notification_kind" ADD VALUE 'booking_cancelled';--> statement-breakpoint
ALTER TYPE "payment_event_operation" ADD VALUE 'stripe_dashboard_refund';--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"order_id" uuid,
	"checkout_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"evidence_due_by" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_amount_nonnegative" CHECK ("amount_cents" >= 0),
	CONSTRAINT "payment_disputes_one_target" CHECK (("order_id" is null) <> ("checkout_id" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
CREATE INDEX "booking_checkouts_stripe_payment_intent_idx" ON "booking_checkouts" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "orders_stripe_payment_intent_idx" ON "orders" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_disputes_stripe_dispute_unique" ON "payment_disputes" ("stripe_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_shop_open_idx" ON "payment_disputes" ("shop_id","evidence_due_by") WHERE "closed_at" is null;--> statement-breakpoint
CREATE INDEX "payment_disputes_shop_order_idx" ON "payment_disputes" ("shop_id","order_id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_refunded_nonnegative" CHECK ("refunded_cents" >= 0);