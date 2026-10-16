ALTER TABLE "people" ADD COLUMN "drysuit_experience_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "drysuit_experience_seen_by_person_id" uuid;