CREATE TABLE "trip_last_minute_promo_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_promo_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_promo_idx" ON "trip_last_minute_promo_recipients" ("trip_promo_id");--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_person_idx" ON "trip_last_minute_promo_recipients" ("person_id");--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_shop_person_idx" ON "trip_last_minute_promo_recipients" ("shop_id","person_id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_SoZT25MYUx9D_fkey" FOREIGN KEY ("trip_promo_id") REFERENCES "trip_last_minute_promos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");