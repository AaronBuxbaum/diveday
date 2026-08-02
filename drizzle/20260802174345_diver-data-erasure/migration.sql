ALTER TYPE "media_deletion_kind" ADD VALUE 'certification_card';--> statement-breakpoint
ALTER TYPE "media_deletion_kind" ADD VALUE 'waiver_document';--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "anonymized_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "anonymized_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_stays_removed" CHECK ("anonymized_at" is null or "deleted_at" is not null);