CREATE TABLE "platform_backup_progress" (
	"shop_id" uuid PRIMARY KEY,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "platform_backup_progress_attempted_idx" ON "platform_backup_progress" ("last_attempt_at");--> statement-breakpoint
CREATE INDEX "platform_backup_progress_lease_idx" ON "platform_backup_progress" ("lease_until");--> statement-breakpoint
ALTER TABLE "platform_backup_progress" ADD CONSTRAINT "platform_backup_progress_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;