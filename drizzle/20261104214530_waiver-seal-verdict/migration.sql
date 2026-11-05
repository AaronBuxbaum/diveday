ALTER TABLE "waiver_records" ADD COLUMN "integrity_valid" boolean;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "integrity_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "waiver_records_integrity_checked_idx" ON "waiver_records" ("integrity_checked_at") WHERE "integrity_hash" is not null and "integrity_version" is not null;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_integrity_verdict_whole" CHECK (("integrity_valid" is null) = ("integrity_checked_at" is null));