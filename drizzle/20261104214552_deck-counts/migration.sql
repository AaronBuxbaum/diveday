CREATE TABLE "deck_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checkpoint" text NOT NULL,
	"counted" integer NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "deck_counts_counted_range" CHECK ("counted" >= 0 and "counted" <= 999)
);
--> statement-breakpoint
CREATE INDEX "deck_counts_shop_trip_checkpoint_idx" ON "deck_counts" ("shop_id","trip_id","checkpoint","recorded_at","seq");--> statement-breakpoint
CREATE INDEX "deck_counts_recorded_by_person_id_idx" ON "deck_counts" ("recorded_by_person_id");--> statement-breakpoint
ALTER TABLE "deck_counts" ADD CONSTRAINT "deck_counts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "deck_counts" ADD CONSTRAINT "deck_counts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deck_counts" ADD CONSTRAINT "deck_counts_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");