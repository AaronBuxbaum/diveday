ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_declined_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_6ecGsdLDogQb_fkey" FOREIGN KEY ("medical_clearance_declined_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
-- diveday:allow-destructive drop-constraint waiver_records.waiver_records_medical_clearance_attributed: the previous release never writes medical_clearance_declined_at, so with it null every new predicate reduces to the old one, and the drop and add are one atomic ALTER with no window between them
ALTER TABLE "waiver_records" DROP CONSTRAINT "waiver_records_medical_clearance_attributed", ADD CONSTRAINT "waiver_records_medical_clearance_attributed" CHECK (("medical_cleared_at" is null) = ("medical_cleared_by_person_id" is null)
        and ("medical_clearance_declined_at" is null) = ("medical_clearance_declined_by_person_id" is null)
        and ("medical_cleared_at" is null or "medical_clearance_declined_at" is null)
        and ("medical_clearance_document_url" is null
          or "medical_cleared_at" is not null
          or "medical_clearance_declined_at" is not null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint waiver_records.waiver_records_medical_clearance_needs_referral: the previous release never writes medical_clearance_declined_at, so with it null every new predicate reduces to the old one, and the drop and add are one atomic ALTER with no window between them
ALTER TABLE "waiver_records" DROP CONSTRAINT "waiver_records_medical_clearance_needs_referral", ADD CONSTRAINT "waiver_records_medical_clearance_needs_referral" CHECK (("medical_cleared_at" is null and "medical_clearance_declined_at" is null)
        or "medical_review_required");--> statement-breakpoint
-- diveday:allow-destructive drop-constraint waiver_records.waiver_records_medical_clearance_evidenced: the previous release never writes medical_clearance_declined_at, so with it null every new predicate reduces to the old one, and the drop and add are one atomic ALTER with no window between them
ALTER TABLE "waiver_records" DROP CONSTRAINT "waiver_records_medical_clearance_evidenced", ADD CONSTRAINT "waiver_records_medical_clearance_evidenced" CHECK (("medical_cleared_at" is null and "medical_clearance_declined_at" is null)
        or "anonymized_at" is not null or (
        "medical_clearance_evaluated_on" is not null
        and ("medical_clearance_document_url" is not null
          or "medical_clearance_physician_name" is not null)));