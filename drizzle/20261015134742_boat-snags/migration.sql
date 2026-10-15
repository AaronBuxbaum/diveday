CREATE TABLE "boat_snags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"noted_on_trip_id" uuid NOT NULL,
	"note" text NOT NULL,
	"noted_by_person_id" uuid NOT NULL,
	"noted_at" timestamp with time zone NOT NULL,
	"still_there_on_trip_id" uuid,
	"still_there_by_person_id" uuid,
	"still_there_at" timestamp with time zone,
	"fixed_on_trip_id" uuid,
	"fixed_by_person_id" uuid,
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boat_snags_note_length" CHECK (char_length("note") between 1 and 280),
	CONSTRAINT "boat_snags_fixed_whole" CHECK (("fixed_at" is null) = ("fixed_by_person_id" is null)),
	CONSTRAINT "boat_snags_still_there_whole" CHECK (("still_there_at" is null) = ("still_there_by_person_id" is null))
);
--> statement-breakpoint
CREATE INDEX "boat_snags_shop_boat_open_idx" ON "boat_snags" ("shop_id","boat_id","noted_at") WHERE "fixed_at" is null;--> statement-breakpoint
CREATE INDEX "boat_snags_noted_on_trip_idx" ON "boat_snags" ("shop_id","noted_on_trip_id");--> statement-breakpoint
CREATE INDEX "boat_snags_noted_by_person_id_idx" ON "boat_snags" ("noted_by_person_id");--> statement-breakpoint
CREATE INDEX "boat_snags_still_there_by_person_id_idx" ON "boat_snags" ("still_there_by_person_id");--> statement-breakpoint
CREATE INDEX "boat_snags_fixed_by_person_id_idx" ON "boat_snags" ("fixed_by_person_id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_scbYNnLxsRZb_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "pre_departure_checklist_items"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_noted_on_trip_id_trips_id_fkey" FOREIGN KEY ("noted_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_noted_by_person_id_people_id_fkey" FOREIGN KEY ("noted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_still_there_on_trip_id_trips_id_fkey" FOREIGN KEY ("still_there_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_still_there_by_person_id_people_id_fkey" FOREIGN KEY ("still_there_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_fixed_on_trip_id_trips_id_fkey" FOREIGN KEY ("fixed_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_fixed_by_person_id_people_id_fkey" FOREIGN KEY ("fixed_by_person_id") REFERENCES "people"("id");