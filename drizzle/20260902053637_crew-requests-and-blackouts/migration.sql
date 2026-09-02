CREATE TYPE "crew_request_decision" AS ENUM('approved', 'declined');--> statement-breakpoint
CREATE TABLE "crew_assignment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "crew_request_decision",
	"decided_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_assignment_requests_decided_together" CHECK (("decision" is null) = ("decided_at" is null)
        and ("decision" is null) = ("decided_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "crew_availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_availability_blocks_ends_on_or_after" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_assignment_requests_live_idx" ON "crew_assignment_requests" ("trip_id","person_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_trip_idx" ON "crew_assignment_requests" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_person_idx" ON "crew_assignment_requests" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_person_idx" ON "crew_availability_blocks" ("shop_id","person_id","starts_on") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_range_idx" ON "crew_availability_blocks" ("shop_id","starts_on","ends_on") WHERE deleted_at is null;--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_decided_by_person_id_people_id_fkey" FOREIGN KEY ("decided_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");