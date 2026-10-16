ALTER TABLE "inbox_saved_answers" ADD COLUMN "source_person_id" uuid;--> statement-breakpoint
CREATE INDEX "inbox_saved_answers_source_person_idx" ON "inbox_saved_answers" ("shop_id","source_person_id");--> statement-breakpoint
ALTER TABLE "inbox_saved_answers" ADD CONSTRAINT "inbox_saved_answers_source_person_id_people_id_fkey" FOREIGN KEY ("source_person_id") REFERENCES "people"("id");