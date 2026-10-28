ALTER TYPE "media_deletion_kind" ADD VALUE 'boat_photo' BEFORE 'payment_receipt';--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "photo_url" text;