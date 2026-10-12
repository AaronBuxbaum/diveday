ALTER TYPE "crew_notice_change" ADD VALUE 'time_moved';--> statement-breakpoint
ALTER TABLE "crew_notices" ADD COLUMN "previous_starts_at" timestamp with time zone;