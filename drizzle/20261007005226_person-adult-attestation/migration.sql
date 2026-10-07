ALTER TABLE "people" ADD COLUMN "adult_attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "adult_attested_by_person_id" uuid;