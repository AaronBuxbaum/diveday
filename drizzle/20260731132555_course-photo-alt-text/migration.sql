ALTER TABLE "courses" ADD COLUMN "hero_image_alt" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "image_alts" jsonb DEFAULT '[]' NOT NULL;