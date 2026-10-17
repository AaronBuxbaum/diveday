ALTER TABLE "bookings" ADD COLUMN "held_emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "held_emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD COLUMN "max_age_years" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_held_emergency_contact_pair" CHECK (("held_emergency_contact_name" is null) = ("held_emergency_contact_phone" is null));--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_max_age_sane" CHECK ("max_age_years" is null or ("max_age_years" >= 1 and "max_age_years" <= 120));