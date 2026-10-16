ALTER TABLE "incident_reports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "incident_reports_live_drafts_idx" ON "incident_reports" ("shop_id","created_at") WHERE "status" = 'draft' and "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_deleted_draft_only" CHECK ("deleted_at" is null or "status" = 'draft');--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_deleted_by_whom" CHECK (("deleted_at" is null) = ("deleted_by_person_id" is null));