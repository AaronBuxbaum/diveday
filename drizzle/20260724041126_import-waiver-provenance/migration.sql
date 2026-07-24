ALTER TABLE "waiver_records" ADD COLUMN "imported_from_label" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "import_source_document_url" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "import_source_medical_document_url" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ALTER COLUMN "booking_id" DROP NOT NULL;