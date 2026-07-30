CREATE TYPE "shop_promo_scope" AS ENUM('all', 'trips', 'courses');--> statement-breakpoint
CREATE TYPE "shop_promo_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TABLE "shop_promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_percent" integer NOT NULL,
	"scope" "shop_promo_scope" DEFAULT 'all'::"shop_promo_scope" NOT NULL,
	"status" "shop_promo_status" DEFAULT 'pending'::"shop_promo_status" NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_promo_codes_discount_range" CHECK ("discount_percent" between 1 and 100),
	CONSTRAINT "shop_promo_codes_max_redemptions_positive" CHECK ("max_redemptions" is null or "max_redemptions" > 0),
	CONSTRAINT "shop_promo_codes_window" CHECK ("starts_at" is null or "expires_at" is null or "starts_at" < "expires_at")
);
--> statement-breakpoint
CREATE TABLE "shop_promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"amount_charged_cents" integer NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_reviews_rating_range" CHECK ("rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "promo_code" text;--> statement-breakpoint
CREATE INDEX "shop_promo_codes_shop_created_idx" ON "shop_promo_codes" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_promo_codes_shop_code_unique" ON "shop_promo_codes" ("shop_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_promo_redemptions_checkout_unique" ON "shop_promo_redemptions" ("checkout_id");--> statement-breakpoint
CREATE INDEX "shop_promo_redemptions_promo_idx" ON "shop_promo_redemptions" ("promo_code_id","redeemed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reviews_booking_unique" ON "trip_reviews" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_published_idx" ON "trip_reviews" ("shop_id","published_at") WHERE "is_published";--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_created_idx" ON "trip_reviews" ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_promo_code_id_shop_promo_codes_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "shop_promo_codes"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_promo_code_id_shop_promo_codes_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "shop_promo_codes"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");