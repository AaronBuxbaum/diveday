ALTER TABLE "trips" ADD COLUMN "recap_auto_send_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "recap_auto_send_at" timestamp with time zone;--> statement-breakpoint
-- diveday:allow-destructive drop-constraint trips.trips_boat_id_boats_id_fkey: re-added in same statement with identical definition by drizzle-kit
ALTER TABLE "trips" DROP CONSTRAINT "trips_boat_id_boats_id_fkey", ADD CONSTRAINT "trips_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;