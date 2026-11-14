ALTER TABLE "shops" ADD COLUMN "time_off_approval_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD COLUMN "decided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_decided_by_person_id_people_id_fkey" FOREIGN KEY ("decided_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_status_known" CHECK ("status" in ('pending', 'approved', 'declined'));