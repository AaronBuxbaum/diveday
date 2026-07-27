CREATE TYPE "tip_status" AS ENUM('pending', 'paid', 'expired');--> statement-breakpoint
CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "tip_status" DEFAULT 'pending'::"tip_status" NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"checkout_url" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"amount_cents" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tips_amount_positive" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tips_stripe_session_unique" ON "tips" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "tips_shop_booking_idx" ON "tips" ("shop_id","booking_id");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");