CREATE TABLE "trip_lenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "lens_id" uuid;--> statement-breakpoint
CREATE INDEX "trip_lenses_shop_live_idx" ON "trip_lenses" ("shop_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_lenses_shop_slug_key" ON "trip_lenses" ("shop_id","slug") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "trip_lenses" ADD CONSTRAINT "trip_lenses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_lens_id_trip_lenses_id_fkey" FOREIGN KEY ("lens_id") REFERENCES "trip_lenses"("id") ON DELETE SET NULL;