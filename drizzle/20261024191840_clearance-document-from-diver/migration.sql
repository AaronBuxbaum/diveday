ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_document_from_diver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_clearance_document_from_diver" CHECK (not "medical_clearance_document_from_diver"
        or "medical_clearance_document_url" is not null
        or "anonymized_at" is not null);