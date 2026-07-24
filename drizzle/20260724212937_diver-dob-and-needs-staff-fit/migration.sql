ALTER TABLE "people" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "needs_staff_fit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "needs_staff_fit_note" text;