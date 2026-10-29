ALTER TABLE "booking_capabilities" ADD COLUMN "returning_order" bigserial;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "returning_device_hash" text;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD COLUMN "returning_device_generation" text;--> statement-breakpoint
CREATE INDEX "booking_capabilities_returning_device_idx" ON "booking_capabilities" ("returning_device_hash","purpose","returning_order") WHERE "returning_device_hash" is not null;