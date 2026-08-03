ALTER TYPE "processor_erasure_target" ADD VALUE 'stripe_invoice_snapshot';--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD COLUMN "stripe_account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD COLUMN "last_error" text;