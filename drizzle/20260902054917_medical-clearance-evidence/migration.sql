ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_evaluated_on" date;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "medical_clearance_physician_name" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_clearance_evidenced" CHECK ("medical_cleared_at" is null or "anonymized_at" is not null or (
        "medical_clearance_evaluated_on" is not null
        and ("medical_clearance_document_url" is not null
          or "medical_clearance_physician_name" is not null)));