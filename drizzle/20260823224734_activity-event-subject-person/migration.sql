ALTER TABLE "activity_events" ADD COLUMN "subject_person_id" uuid;--> statement-breakpoint
CREATE INDEX "activity_events_shop_subject_idx" ON "activity_events" ("shop_id","subject_person_id","occurred_at");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_subject_person_id_people_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "people"("id");