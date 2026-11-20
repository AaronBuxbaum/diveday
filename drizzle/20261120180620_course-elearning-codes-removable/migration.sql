ALTER TABLE "course_elearning_codes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "course_elearning_codes_code_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "course_elearning_codes_code_unique" ON "course_elearning_codes" ("shop_id","course_id","code") WHERE "deleted_at" is null;--> statement-breakpoint
DROP INDEX "course_elearning_codes_stock_idx";--> statement-breakpoint
CREATE INDEX "course_elearning_codes_stock_idx" ON "course_elearning_codes" ("shop_id","course_id","created_at") WHERE "booking_id" is null and "deleted_at" is null;