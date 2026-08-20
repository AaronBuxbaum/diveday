ALTER TABLE "courses" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;