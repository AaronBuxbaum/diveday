CREATE TYPE "backup_delivery_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "backup_delivery_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TABLE "shop_backup_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"trigger" "backup_delivery_trigger" NOT NULL,
	"status" "backup_delivery_status" NOT NULL,
	"object_key" text,
	"byte_count" bigint,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop_backup_destinations" (
	"shop_id" uuid PRIMARY KEY,
	"endpoint" text NOT NULL,
	"region" text NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key_sealed" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_started_idx" ON "shop_backup_deliveries" ("shop_id","started_at");--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_period_idx" ON "shop_backup_deliveries" ("shop_id","period_key");--> statement-breakpoint
ALTER TABLE "shop_backup_deliveries" ADD CONSTRAINT "shop_backup_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_backup_destinations" ADD CONSTRAINT "shop_backup_destinations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");