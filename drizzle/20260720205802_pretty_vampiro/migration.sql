ALTER TABLE "global_course_versions" DROP CONSTRAINT "global_course_versions_global_course_id_global_courses_id_fkey";--> statement-breakpoint
DROP TABLE "global_course_versions";--> statement-breakpoint
DROP TABLE "global_courses";--> statement-breakpoint
DROP INDEX "waiver_templates_shop_default_idx";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "related_course_ids";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "source_template_id";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "source_template_version";--> statement-breakpoint
ALTER TABLE "waiver_templates" DROP COLUMN "is_default";