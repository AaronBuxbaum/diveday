CREATE TABLE "global_course_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"global_course_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"agency" text NOT NULL,
	"description" text,
	"minimum_certification_level" "certification_level",
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL UNIQUE,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "courses" SET "slug" = CASE
	WHEN "derived" = '' THEN 'course'
	WHEN "derived" IN ('catalog', 'new') THEN "derived" || '-course'
	ELSE "derived"
END FROM (
	SELECT "id" AS "slug_id", rtrim(left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 80), '-') AS "derived"
	FROM "courses"
) AS "slugs" WHERE "slugs"."slug_id" = "courses"."id";--> statement-breakpoint
UPDATE "courses" SET "slug" = "courses"."slug" || '-' || "dupes"."rank" FROM (
	SELECT "id" AS "dupe_id", row_number() OVER (PARTITION BY "shop_id", "slug" ORDER BY "created_at", "id") AS "rank"
	FROM "courses"
) AS "dupes" WHERE "dupes"."dupe_id" = "courses"."id" AND "dupes"."rank" > 1;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "overview" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "hero_image_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "image_urls" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "duration_text" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "group_size_text" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "minimum_age" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "prerequisite_note" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "includes" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "excludes" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "schedule_days" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "faqs" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "related_course_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "source_template_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "source_template_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_slug_unique" ON "courses" ("shop_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "global_course_versions_unique" ON "global_course_versions" ("global_course_id","version");--> statement-breakpoint
CREATE INDEX "global_courses_slug_idx" ON "global_courses" ("slug");--> statement-breakpoint
ALTER TABLE "global_course_versions" ADD CONSTRAINT "global_course_versions_global_course_id_global_courses_id_fkey" FOREIGN KEY ("global_course_id") REFERENCES "global_courses"("id");