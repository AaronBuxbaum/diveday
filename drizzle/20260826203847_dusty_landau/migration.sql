ALTER TABLE "dive_sites" ADD COLUMN "conservation_note" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "conservation_commitments" jsonb DEFAULT '[]' NOT NULL;