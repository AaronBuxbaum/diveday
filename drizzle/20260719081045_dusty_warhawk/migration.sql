ALTER TABLE "dive_sites" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "deleted_at" timestamp with time zone;