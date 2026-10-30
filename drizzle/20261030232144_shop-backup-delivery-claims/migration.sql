ALTER TYPE "backup_delivery_status" ADD VALUE 'superseded';--> statement-breakpoint
CREATE TABLE "shop_backup_delivery_claims" (
	"shop_id" uuid,
	"period_key" text,
	"attempt_number" integer NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "shop_backup_delivery_claims_pkey" PRIMARY KEY("shop_id","period_key")
);
--> statement-breakpoint
CREATE INDEX "shop_backup_delivery_claims_lease_idx" ON "shop_backup_delivery_claims" ("lease_until");--> statement-breakpoint
ALTER TABLE "shop_backup_delivery_claims" ADD CONSTRAINT "shop_backup_delivery_claims_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;