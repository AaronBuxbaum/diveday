CREATE TABLE "recovery_activities" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"blowout_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"capacity" integer NOT NULL,
	"coordinator_person_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"arrangements_confirmed_by_person_id" uuid NOT NULL,
	"arrangements_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recovery_activities_capacity" CHECK ("capacity" between 1 and 500),
	CONSTRAINT "recovery_activities_times" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "recovery_activities_status" CHECK ("status" in ('scheduled', 'cancelled')),
	CONSTRAINT "recovery_activities_revision" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_events" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"participant_id" uuid,
	"actor_person_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result_revision" integer NOT NULL,
	"code" text NOT NULL,
	"transition" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_activity_events_code" CHECK ("code" in ('identity_merged', 'created', 'offer_prepared', 'place_confirmed', 'place_cancelled', 'activity_cancelled', 'capacity_changed'))
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_offers" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_person_id" uuid NOT NULL,
	CONSTRAINT "recovery_activity_participants_status" CHECK ("status" in ('confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "people_shop_id_id_unique" ON "people" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowouts_shop_id_id_unique" ON "trip_blowouts" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activities_shop_id_id_unique" ON "recovery_activities" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "recovery_activities_blowout_idx" ON "recovery_activities" ("shop_id","blowout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_offers_activity_diver_unique" ON "recovery_activity_offers" ("shop_id","activity_id","blowout_diver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_shop_id_id_unique" ON "recovery_activity_participants" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_person_unique" ON "recovery_activity_participants" ("shop_id","activity_id","person_id") WHERE "status" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_source_unique" ON "recovery_activity_participants" ("shop_id","activity_id","blowout_diver_id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_blowout_id_trip_blowouts_id_fkey" FOREIGN KEY ("blowout_id") REFERENCES "trip_blowouts"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_coordinator_person_id_people_id_fkey" FOREIGN KEY ("coordinator_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_bVUYjHBbU8Xb_fkey" FOREIGN KEY ("arrangements_confirmed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_blowout_fk" FOREIGN KEY ("shop_id","blowout_id") REFERENCES "trip_blowouts"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_0_fk" FOREIGN KEY ("shop_id","coordinator_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_1_fk" FOREIGN KEY ("shop_id","created_by_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_2_fk" FOREIGN KEY ("shop_id","arrangements_confirmed_by_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_participant_fk" FOREIGN KEY ("shop_id","participant_id") REFERENCES "recovery_activity_participants"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_actor_fk" FOREIGN KEY ("shop_id","actor_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_actor_fk" FOREIGN KEY ("shop_id","actor_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_H7S89mKADLXG_fkey" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_person_fk" FOREIGN KEY ("shop_id","person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_actor_fk" FOREIGN KEY ("shop_id","confirmed_by_person_id") REFERENCES "people"("shop_id","id");