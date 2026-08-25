ALTER TABLE "people" ADD COLUMN "merged_into_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "merged_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_person_id_people_id_fkey" FOREIGN KEY ("merged_into_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_by_person_id_people_id_fkey" FOREIGN KEY ("merged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_stays_removed" CHECK ("merged_into_person_id" is null or "deleted_at" is not null);--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merge_metadata_complete" CHECK (("merged_into_person_id" is null and "merged_at" is null and "merged_by_person_id" is null) or ("merged_into_person_id" is not null and "merged_at" is not null and "merged_by_person_id" is not null));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_cannot_merge_into_self" CHECK ("merged_into_person_id" is null or "merged_into_person_id" <> "id");
