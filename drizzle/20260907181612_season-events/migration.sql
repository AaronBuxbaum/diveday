CREATE TABLE "season_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"lens_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "season_events_ends_on_or_after" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE INDEX "season_events_shop_range_idx" ON "season_events" ("shop_id","starts_on","ends_on") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "season_events" ADD CONSTRAINT "season_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "season_events" ADD CONSTRAINT "season_events_lens_id_trip_lenses_id_fkey" FOREIGN KEY ("lens_id") REFERENCES "trip_lenses"("id") ON DELETE SET NULL;