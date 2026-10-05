ALTER TABLE "waiver_records" ADD COLUMN "moved_from_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "moved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "moved_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_moved_from_person_id_people_id_fkey" FOREIGN KEY ("moved_from_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_moved_by_person_id_people_id_fkey" FOREIGN KEY ("moved_by_person_id") REFERENCES "people"("id");