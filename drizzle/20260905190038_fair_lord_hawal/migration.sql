ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_confirmed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_fit_confirmed_by_person_id_people_id_fkey" FOREIGN KEY ("fit_confirmed_by_person_id") REFERENCES "people"("id");