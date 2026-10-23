ALTER TABLE "shops" ADD COLUMN "lost_found_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "work_orders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "promo_codes_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "dive_packages_enabled" boolean DEFAULT true NOT NULL;