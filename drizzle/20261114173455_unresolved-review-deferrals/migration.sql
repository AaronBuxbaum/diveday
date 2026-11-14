CREATE TABLE "unresolved_review_deferrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"review_revision" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD COLUMN "review_revision" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_review_deferrals_shop_request_unique" ON "unresolved_review_deferrals" ("shop_id","request_id");--> statement-breakpoint
ALTER TABLE "unresolved_review_deferrals" ADD CONSTRAINT "unresolved_review_deferrals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "unresolved_review_deferrals" ADD CONSTRAINT "unresolved_review_deferrals_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "unresolved_review_deferrals" ADD CONSTRAINT "unresolved_review_deferrals_RkCswdcay9BQ_fkey" FOREIGN KEY ("claim_id") REFERENCES "roll_call_event_claims"("id");--> statement-breakpoint
ALTER TABLE "unresolved_review_deferrals" ADD CONSTRAINT "unresolved_review_deferrals_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");