-- diveday:allow-destructive drop-constraint booking_checkouts.booking_checkouts_tip_shape: re-added in the same statement naming deal_id in place of the two retired promo columns (issue #2720); a tip never carries a promotion, so no row written meanwhile can fail it
CREATE TYPE "deal_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"discount_percent" integer,
	"discount_amount_cents" integer,
	"scope" "shop_promo_scope" DEFAULT 'all'::"shop_promo_scope" NOT NULL,
	"status" "deal_status" DEFAULT 'pending'::"deal_status" NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_discount_range" CHECK ("discount_percent" is null or ("trip_id" is null and "discount_percent" between 1 and 100) or ("trip_id" is not null and "discount_percent" between 5 and 90)),
	CONSTRAINT "deals_discount_amount_positive" CHECK ("discount_amount_cents" is null or "discount_amount_cents" > 0),
	CONSTRAINT "deals_one_discount" CHECK (("discount_percent" is null) <> ("discount_amount_cents" is null)),
	CONSTRAINT "deals_max_redemptions_positive" CHECK ("max_redemptions" is null or "max_redemptions" > 0),
	CONSTRAINT "deals_window" CHECK ("starts_at" is null or "expires_at" is null or "starts_at" < "expires_at"),
	CONSTRAINT "deals_trip_shape" CHECK ("trip_id" is null or ("expires_at" is not null and "starts_at" is null and "status" <> 'disabled' and "scope" = 'all' and "description" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
CREATE INDEX "deals_shop_created_idx" ON "deals" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_trip_created_idx" ON "deals" ("trip_id","created_at") WHERE "trip_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deals_shop_code_unique" ON "deals" ("shop_id","code");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_deal_id_deals_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_deal_id_deals_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP CONSTRAINT "booking_checkouts_tip_shape", ADD CONSTRAINT "booking_checkouts_tip_shape" CHECK ("purpose" <> 'tip' or (not "is_deposit" and "deal_id" is null and "applied_discount_percent" is null and "applied_discount_cents" is null and not "tax_enabled" and "pass_through_cents" = 0));