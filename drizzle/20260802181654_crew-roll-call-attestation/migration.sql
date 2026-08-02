CREATE TABLE "roll_call_crew_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checkpoint" text NOT NULL,
	"crew_aboard" integer NOT NULL,
	"crew_assigned" integer NOT NULL,
	"attested_by_person_id" uuid NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roll_call_crew_attestations_shop_trip_checkpoint_occurred_idx" ON "roll_call_crew_attestations" ("shop_id","trip_id","checkpoint","occurred_at");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_8HpD6wd6GQjn_fkey" FOREIGN KEY ("attested_by_person_id") REFERENCES "people"("id");