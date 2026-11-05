ALTER TABLE "booking_capabilities" ADD COLUMN "key_version" smallint;--> statement-breakpoint
ALTER TABLE "booking_capabilities" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_capabilities_live_link_idx" ON "booking_capabilities" ("booking_id","purpose","delivered") WHERE "revoked_at" is null and "source_capability_id" is null;