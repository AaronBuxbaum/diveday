ALTER TABLE "boats" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "boats_shop_live_idx" ON "boats" ("shop_id") WHERE "deleted_at" is null;