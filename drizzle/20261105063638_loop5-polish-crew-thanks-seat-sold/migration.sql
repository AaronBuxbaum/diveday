ALTER TABLE "shops" ADD COLUMN "seat_sold_alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "seat_sold_alerted_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks_person_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks" text;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks_hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trip_reviews_crew_thanks_idx" ON "trip_reviews" ("crew_thanks_person_id","shop_id","created_at") WHERE "crew_thanks" is not null;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_person_id_people_id_fkey" FOREIGN KEY ("crew_thanks_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_pair" CHECK (("crew_thanks_person_id" is null) = ("crew_thanks" is null) and ("crew_thanks" is null or (length(btrim("crew_thanks")) > 0 and length("crew_thanks") <= 200)));