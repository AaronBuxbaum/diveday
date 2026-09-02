ALTER TABLE "waiver_records" ADD COLUMN "medical_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "medical_cleared_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_document_url" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("medical_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_clearance_attributed" CHECK (("medical_cleared_at" is null) = ("medical_cleared_by_person_id" is null)
        and ("medical_clearance_document_url" is null or "medical_cleared_at" is not null));--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_clearance_needs_referral" CHECK ("medical_cleared_at" is null or "medical_review_required");