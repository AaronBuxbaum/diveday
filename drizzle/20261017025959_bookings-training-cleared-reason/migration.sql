ALTER TABLE "bookings" ADD COLUMN "training_cleared_reason" text;--> statement-breakpoint
-- Every clear stamped before the reason existed was one with forms owed.
UPDATE "bookings" SET "training_cleared_reason" = 'forms_owed' WHERE "training_cleared_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_training_cleared_attributed", ADD CONSTRAINT "bookings_training_cleared_attributed" CHECK (("training_cleared_at" is null) = ("training_cleared_by_person_id" is null)
        and ("training_cleared_at" is null) = ("training_cleared_reason" is null)
        and ("training_cleared_reason" is null or "training_cleared_reason" in ('forms_owed', 'mark_invalid')));