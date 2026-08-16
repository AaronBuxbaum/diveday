ALTER TABLE "courses" ADD COLUMN "source_template_slug" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "source_template_version" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "source_template_snapshot" jsonb;