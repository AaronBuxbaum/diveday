ALTER TABLE "dive_sites" ADD COLUMN "route_points" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "route_label" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "route_note" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "route_zoom" integer DEFAULT 16 NOT NULL;