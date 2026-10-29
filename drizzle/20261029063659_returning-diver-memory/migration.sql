ALTER TYPE "booking_capability_purpose" ADD VALUE 'returning_diver_receipt';--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "returning_order" bigserial;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "returning_device_hash" text;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "returning_device_generation" text;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "source_capability_id" uuid;--> statement-breakpoint
CREATE INDEX "booking_capabilities_returning_device_idx" ON "booking_capabilities" ("returning_device_hash","purpose","returning_order") WHERE "returning_device_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_capabilities_returning_receipt_source_unique" ON "booking_capabilities" ("source_capability_id") WHERE "source_capability_id" is not null;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_returning_diver_source" CHECK (("purpose"::text = 'returning_diver_receipt') = ("source_capability_id" is not null));