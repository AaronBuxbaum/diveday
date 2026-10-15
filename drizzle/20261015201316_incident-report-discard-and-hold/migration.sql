ALTER TABLE "incident_reports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "incident_reports_shop_trip_idx";--> statement-breakpoint
CREATE INDEX "incident_reports_shop_trip_idx" ON "incident_reports" ("shop_id","trip_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_only_a_draft_is_discarded" CHECK ("deleted_at" is null or "status" = 'draft');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_a_held_report_is_kept" CHECK ("legal_hold_at" is null or "deleted_at" is null);