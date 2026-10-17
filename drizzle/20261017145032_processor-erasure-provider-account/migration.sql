ALTER TYPE "processor_erasure_target" ADD VALUE 'whatsapp_conversation';--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ALTER COLUMN "stripe_account_id" DROP NOT NULL;