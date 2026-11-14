CREATE TYPE "boarding_observation_state" AS ENUM('pending', 'applied', 'conflict', 'dismissed');--> statement-breakpoint
CREATE TABLE "boarding_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "boarding_observation_state" DEFAULT 'pending'::"boarding_observation_state" NOT NULL,
	"conflict_code" text,
	"settled_at" timestamp with time zone,
	"dismissed_by_person_id" uuid,
	CONSTRAINT "boarding_observations_client_key_length" CHECK (length("client_key") between 8 and 100),
	CONSTRAINT "boarding_observations_conflict_has_code" CHECK (("state" = 'conflict') = ("conflict_code" is not null)),
	CONSTRAINT "boarding_observations_settled_unless_pending" CHECK (("state" = 'pending') = ("settled_at" is null)),
	CONSTRAINT "boarding_observations_dismissed_by" CHECK (("state" = 'dismissed') = ("dismissed_by_person_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_observations_client_key_unique" ON "boarding_observations" ("shop_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_observations_open_seat_unique" ON "boarding_observations" ("booking_id") WHERE "state" in ('pending', 'conflict');--> statement-breakpoint
CREATE INDEX "boarding_observations_open_trip_idx" ON "boarding_observations" ("shop_id","trip_id") WHERE "state" in ('pending', 'conflict');--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_dismissed_by_person_id_people_id_fkey" FOREIGN KEY ("dismissed_by_person_id") REFERENCES "people"("id");