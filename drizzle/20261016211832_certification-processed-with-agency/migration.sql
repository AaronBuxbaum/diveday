ALTER TABLE "certifications" ADD COLUMN "processed_with_agency_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "processed_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "certifications_processed_by_person_idx" ON "certifications" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null);