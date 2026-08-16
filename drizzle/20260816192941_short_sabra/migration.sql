ALTER TABLE "certifications" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");