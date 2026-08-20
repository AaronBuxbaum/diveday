ALTER TABLE "certifications" ADD COLUMN "reviewed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "reviewed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "reviewed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");