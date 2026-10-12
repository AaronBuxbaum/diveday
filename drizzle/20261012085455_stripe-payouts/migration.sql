CREATE TABLE "stripe_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"arrival_date" timestamp with time zone NOT NULL,
	"failure_code" text,
	"covered_from" timestamp with time zone,
	"covered_to" timestamp with time zone,
	"fee_cents" integer,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_payouts_stripe_payout_unique" ON "stripe_payouts" ("stripe_payout_id");--> statement-breakpoint
CREATE INDEX "stripe_payouts_shop_arrival_idx" ON "stripe_payouts" ("shop_id","arrival_date") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "stripe_payouts" ADD CONSTRAINT "stripe_payouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");