ALTER TABLE "incident_reports" ADD COLUMN "missing_alert_attempting_person_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_all_clear_sent_person_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_all_clear_leased_at" timestamp with time zone;