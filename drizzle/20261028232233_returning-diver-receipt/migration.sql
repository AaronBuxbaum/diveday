ALTER TYPE "booking_capability_purpose" ADD VALUE 'returning_diver_receipt';--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "source_capability_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_capabilities_returning_receipt_source_unique" ON "booking_capabilities" ("source_capability_id") WHERE "source_capability_id" is not null;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_returning_diver_source" CHECK (("purpose" = 'returning_diver_receipt') = ("source_capability_id" is not null));