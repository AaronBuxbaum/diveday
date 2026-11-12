ALTER TYPE "media_deletion_kind" ADD VALUE 'staff_profile' BEFORE 'boat_photo';--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "public_staff_profile_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "public_staff_profile" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "public_staff_profiles_enabled" boolean DEFAULT true NOT NULL;