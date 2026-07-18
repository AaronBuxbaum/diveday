CREATE TABLE "dive_site_creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"image_url" text,
	"description" text,
	"preparation_tip" text
);
--> statement-breakpoint
CREATE TABLE "dive_site_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"caption" text NOT NULL,
	"image_url" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_dive_site_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"global_dive_site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"briefing" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL UNIQUE,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "buddy_preference" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "conditions_briefed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "source_template_id" uuid;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "source_template_version" integer;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "depth_range" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "current_note" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "dive_plan" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "landmarks" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX "dive_site_creatures_site_idx" ON "dive_site_creatures" ("dive_site_id");--> statement-breakpoint
CREATE INDEX "dive_site_moments_site_published_idx" ON "dive_site_moments" ("dive_site_id","is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "global_dive_site_versions_unique" ON "global_dive_site_versions" ("global_dive_site_id","version");--> statement-breakpoint
CREATE INDEX "global_dive_sites_slug_idx" ON "global_dive_sites" ("slug");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "global_dive_site_versions" ADD CONSTRAINT "global_dive_site_versions_1zaEF6XhjlbN_fkey" FOREIGN KEY ("global_dive_site_id") REFERENCES "global_dive_sites"("id");