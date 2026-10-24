ALTER TABLE "waiver_records" ADD COLUMN "diver_medical_form_url" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "diver_medical_form_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_diver_medical_form_held" CHECK ("diver_medical_form_url" is null or (
        "diver_medical_form_sent_at" is not null
        and "medical_review_required"
        and "medical_cleared_at" is null
        and "medical_clearance_declined_at" is null));