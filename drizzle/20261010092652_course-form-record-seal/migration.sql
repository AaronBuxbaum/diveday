ALTER TABLE "course_form_records" ADD COLUMN "integrity_hash" text;--> statement-breakpoint
ALTER TABLE "course_form_records" ADD COLUMN "integrity_version" integer;--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_integrity_whole" CHECK (("integrity_hash" is null) = ("integrity_version" is null));