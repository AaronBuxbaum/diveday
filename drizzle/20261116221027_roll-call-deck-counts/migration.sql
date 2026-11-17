CREATE TABLE "roll_call_deck_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checkpoint" text NOT NULL,
	"counted" integer NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "roll_call_deck_counts_counted_range" CHECK ("counted" between 0 and 999)
);
--> statement-breakpoint
CREATE INDEX "roll_call_deck_counts_shop_trip_checkpoint_idx" ON "roll_call_deck_counts" ("shop_id","trip_id","checkpoint","seq");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");