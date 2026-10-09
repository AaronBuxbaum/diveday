CREATE TYPE "crew_notice_change" AS ENUM('assigned', 'removed', 'request_approved', 'request_declined');--> statement-breakpoint
CREATE TABLE "crew_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"change" "crew_notice_change" NOT NULL,
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"seq" bigserial
);
--> statement-breakpoint
CREATE INDEX "crew_notices_pending_idx" ON "crew_notices" ("shop_id","person_id","seq") WHERE settled_at is null;--> statement-breakpoint
CREATE INDEX "crew_notices_person_idx" ON "crew_notices" ("person_id");--> statement-breakpoint
CREATE INDEX "crew_notices_trip_idx" ON "crew_notices" ("trip_id");--> statement-breakpoint
CREATE INDEX "crew_notices_actor_idx" ON "crew_notices" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "crew_notices_settled_idx" ON "crew_notices" ("settled_at");--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;