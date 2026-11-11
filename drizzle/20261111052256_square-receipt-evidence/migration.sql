ALTER TYPE "integration_provider" ADD VALUE 'square';--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD COLUMN "receipt_evidence" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_square_receipt_unique" ON "integration_sync_records" ("external_id") WHERE "source_type" = 'square_payment_receipt' and "operation" = 'receipt';