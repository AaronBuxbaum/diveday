ALTER TABLE "media_deletion_attempts" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD COLUMN "purge_versions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD CONSTRAINT "media_deletion_attempts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");