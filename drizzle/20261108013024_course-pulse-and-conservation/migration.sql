CREATE TABLE "trip_conservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" double precision NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trip_conservation_kind" CHECK ("kind" in ('litter_kg', 'litter_items', 'line_m')),
	CONSTRAINT "trip_conservation_quantity" CHECK ("quantity" > 0 and "quantity" <= 100000 and ("kind" <> 'litter_items' or "quantity" = trunc("quantity"::numeric)))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "conservation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "course_pulse_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "course_teaching_note" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "course_teaching_note_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "course_teaching_note_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "trip_conservation_live_idx" ON "trip_conservation" ("shop_id","trip_id") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_teaching_note_by_person_id_people_id_fkey" FOREIGN KEY ("course_teaching_note_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");