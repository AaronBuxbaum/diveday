ALTER TYPE "staff_credential_kind" ADD VALUE 'assistant_instructor_rating' BEFORE 'divemaster_rating';--> statement-breakpoint
ALTER TYPE "rental_fit_item" ADD VALUE 'hood';--> statement-breakpoint
ALTER TYPE "rental_fit_item" ADD VALUE 'gloves';--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "certifies_level" "certification_level";--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_hood" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_gloves" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "hood_size" text;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "glove_size" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_email_erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_email_erased_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_DMLfwgLsuWoJ_fkey" FOREIGN KEY ("guardian_email_erased_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_guardian_email_erased_stays_erased" CHECK ("guardian_email_erased_at" is null or "guardian_email" is null);