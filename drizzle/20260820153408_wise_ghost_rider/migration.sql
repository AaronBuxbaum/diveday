ALTER TABLE "trips" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trips_shop_live_starts_idx" ON "trips" ("shop_id","starts_at") WHERE "deleted_at" is null;