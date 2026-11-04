CREATE TYPE "card_deletion_kind" AS ENUM('staff', 'system');--> statement-breakpoint
ALTER TABLE "internal_notes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "deletion_kind" "card_deletion_kind";--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");