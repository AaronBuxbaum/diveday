CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"body" text NOT NULL,
	"written_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_replies_body_length" CHECK (length(trim("body")) between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "is_rehearsal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_replies_review_live_unique" ON "review_replies" ("review_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "review_replies_shop_idx" ON "review_replies" ("shop_id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_written_by_person_id_people_id_fkey" FOREIGN KEY ("written_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rehearsal_is_private" CHECK (not "is_rehearsal" or "is_private");