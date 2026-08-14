CREATE TYPE "review_moderation_action" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TYPE "review_moderation_reason" AS ENUM('abusive', 'names_a_person', 'wrong_subject', 'spam', 'other');--> statement-breakpoint
CREATE TABLE "review_moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"action" "review_moderation_action" NOT NULL,
	"reason" "review_moderation_reason",
	"reason_note" text,
	"recorded_by_person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_moderation_events_hidden_has_reason" CHECK ("action" <> 'hidden' or "reason" is not null),
	CONSTRAINT "review_moderation_events_other_has_note" CHECK ("reason" <> 'other' or length(trim(coalesce("reason_note", ''))) > 0)
);
--> statement-breakpoint
CREATE INDEX "review_moderation_events_shop_idx" ON "review_moderation_events" ("shop_id","occurred_at");--> statement-breakpoint
CREATE INDEX "review_moderation_events_review_idx" ON "review_moderation_events" ("review_id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");