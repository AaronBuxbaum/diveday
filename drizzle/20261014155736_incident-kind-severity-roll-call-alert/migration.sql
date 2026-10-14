CREATE TYPE "incident_kind" AS ENUM('injury', 'near_miss', 'equipment', 'missing_diver', 'other');--> statement-breakpoint
CREATE TYPE "incident_severity" AS ENUM('minor', 'moderate', 'serious');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "kind" "incident_kind";--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "severity" "incident_severity";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "roll_call_alerted_at" timestamp with time zone;