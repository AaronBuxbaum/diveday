CREATE TYPE "order_line_item_kind" AS ENUM('trip_fee', 'course_fee', 'rental_gear', 'deposit', 'merchandise', 'other');--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM('open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_line_item_kind" DEFAULT 'other'::"order_line_item_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'open'::"order_status" NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"total_cents" integer NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"description" text,
	"stripe_account_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_stripe_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_line_items_order_idx" ON "order_line_items" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_invoice_unique" ON "orders" ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_shop_booking_idx" ON "orders" ("shop_id","booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_stripe_accounts_stripe_account_unique" ON "shop_stripe_accounts" ("stripe_account_id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_stripe_accounts" ADD CONSTRAINT "shop_stripe_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");