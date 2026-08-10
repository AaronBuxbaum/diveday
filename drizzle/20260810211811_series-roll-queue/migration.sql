ALTER TABLE "trip_series" ADD COLUMN "last_rolled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trip_series_roll_queue_idx" ON "trip_series" ("last_rolled_at");