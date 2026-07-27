CREATE TYPE "trip_last_minute_promo_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "last_minute_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"available_from" date,
	"available_until" date,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "last_minute_list_entries_range" CHECK ("available_from" is null or "available_until" is null or "available_from" <= "available_until")
);
--> statement-breakpoint
CREATE TABLE "trip_last_minute_promos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "trip_last_minute_promo_status" DEFAULT 'pending'::"trip_last_minute_promo_status" NOT NULL,
	"discount_percent" integer NOT NULL,
	"code" text NOT NULL,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_last_minute_promos_discount_range" CHECK ("discount_percent" between 5 and 90)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "last_minute_list_entries_shop_person_unique" ON "last_minute_list_entries" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "last_minute_list_entries_shop_active_idx" ON "last_minute_list_entries" ("shop_id") WHERE "unsubscribed_at" is null;--> statement-breakpoint
CREATE INDEX "trip_last_minute_promos_trip_created_idx" ON "trip_last_minute_promos" ("trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_last_minute_promos_shop_code_unique" ON "trip_last_minute_promos" ("shop_id","code");--> statement-breakpoint
ALTER TABLE "last_minute_list_entries" ADD CONSTRAINT "last_minute_list_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_entries" ADD CONSTRAINT "last_minute_list_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");