CREATE TYPE "processor_erasure_status" AS ENUM('owed', 'discharged');--> statement-breakpoint
CREATE TYPE "processor_erasure_target" AS ENUM('stripe_customer');--> statement-breakpoint
CREATE TABLE "processor_erasure_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"target" "processor_erasure_target" NOT NULL,
	"external_id" text NOT NULL,
	"status" "processor_erasure_status" DEFAULT 'owed'::"processor_erasure_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharged_by_person_id" uuid,
	CONSTRAINT "processor_erasure_obligations_discharged_consistent" CHECK (("status" = 'discharged') = ("discharged_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "person_id" uuid;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_stale_scan_idx" ON "payment_operation_intents" ("kind","started_at") WHERE "status" = 'started';--> statement-breakpoint
CREATE UNIQUE INDEX "processor_erasure_obligations_shop_target_external_unique" ON "processor_erasure_obligations" ("shop_id","target","external_id");--> statement-breakpoint
CREATE INDEX "processor_erasure_obligations_shop_status_idx" ON "processor_erasure_obligations" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "trips_status_starts_idx" ON "trips" ("status","starts_at");--> statement-breakpoint
CREATE INDEX "trips_status_ends_idx" ON "trips" ("status","ends_at");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_kgvFHJwQGdT5_fkey" FOREIGN KEY ("discharged_by_person_id") REFERENCES "people"("id");