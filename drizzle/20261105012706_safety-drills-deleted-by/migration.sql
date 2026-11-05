ALTER TABLE "safety_drills" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "safety_drills_deleted_by_person_id_idx" ON "safety_drills" ("deleted_by_person_id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_deleted_by_whom" CHECK (("deleted_at" is null) = ("deleted_by_person_id" is null));