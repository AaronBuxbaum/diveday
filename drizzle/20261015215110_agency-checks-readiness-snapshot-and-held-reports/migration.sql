CREATE TYPE "welcome_hello" AS ENUM('first_ocean_dive', 'celebrating', 'nervous');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reschedule_missed_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reschedule_missed_place" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "welcome_hello" "welcome_hello";--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "agency_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "agency_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_forms" ADD COLUMN "medical_screening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "readiness_status" text;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "readiness_blockers" jsonb;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "divers_told_meeting_point" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX "incident_reports_shop_trip_idx";--> statement-breakpoint
CREATE INDEX "incident_reports_shop_trip_idx" ON "incident_reports" ("shop_id","trip_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_readiness_snapshot_shape" CHECK (("readiness_status" is null and "readiness_blockers" is null) or ("status" = 'boarded' and "readiness_status" in ('ready', 'blocked')));--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_only_a_draft_is_discarded" CHECK ("deleted_at" is null or "status" = 'draft');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_a_held_report_is_kept" CHECK ("legal_hold_at" is null or "deleted_at" is null);