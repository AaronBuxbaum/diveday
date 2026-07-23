CREATE TYPE "media_deletion_kind" AS ENUM('course_photo', 'recap_photo');--> statement-breakpoint
CREATE TYPE "media_deletion_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "media_deletion_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "media_deletion_kind" NOT NULL,
	"url" text NOT NULL,
	"status" "media_deletion_status" DEFAULT 'pending'::"media_deletion_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "media_deletion_attempts_shop_status_idx" ON "media_deletion_attempts" ("shop_id","status");--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD CONSTRAINT "media_deletion_attempts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");