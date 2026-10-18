ALTER TABLE "incident_reports" ADD COLUMN "missing_alert_raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_alert_raised_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_subject_row_id" uuid;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_found_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_found_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_all_clear_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "missing_all_clear_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "incident_reports_raised_by_idx" ON "incident_reports" ("missing_alert_raised_by_person_id") WHERE "missing_alert_raised_by_person_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_found_by_idx" ON "incident_reports" ("missing_found_by_person_id") WHERE "missing_found_by_person_id" is not null;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_IROSQXtmQ09n_fkey" FOREIGN KEY ("missing_alert_raised_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_pKE3joE7tHcd_fkey" FOREIGN KEY ("missing_subject_row_id") REFERENCES "incident_report_people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_missing_found_by_person_id_people_id_fkey" FOREIGN KEY ("missing_found_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_raised_by_whom" CHECK (("missing_alert_raised_at" is null) = ("missing_alert_raised_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_found_by_whom" CHECK (("missing_found_at" is null) = ("missing_found_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_missing_only" CHECK (("missing_alert_raised_at" is null and "missing_found_at" is null)
        or "kind" = 'missing_diver');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_found_after_alert" CHECK ("missing_found_at" is null or "missing_alert_raised_at" is not null
        or "status" = 'filed');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_raised_names_its_subject" CHECK ("missing_alert_raised_at" is null or "missing_subject_row_id" is not null);--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_a_raised_report_is_kept" CHECK ("missing_alert_raised_at" is null or "deleted_at" is null);