CREATE TYPE "dive_package_scope" AS ENUM('all', 'fun_dives');--> statement-breakpoint
CREATE TABLE "dive_package_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"booking_id" uuid,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_package_entitlements_consumption_paired" CHECK (("booking_id" is null) = ("consumed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "dive_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dive_count" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"scope" "dive_package_scope" DEFAULT 'all'::"dive_package_scope" NOT NULL,
	"validity_days" integer,
	"deleted_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_packages_dive_count_positive" CHECK ("dive_count" > 0),
	CONSTRAINT "dive_packages_price_positive" CHECK ("price_cents" > 0),
	CONSTRAINT "dive_packages_validity_positive" CHECK ("validity_days" is null or "validity_days" > 0)
);
--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_person_idx" ON "dive_package_entitlements" ("shop_id","person_id") WHERE "consumed_at" is null;--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_order_idx" ON "dive_package_entitlements" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_package_entitlements_booking_unique" ON "dive_package_entitlements" ("booking_id") WHERE "booking_id" is not null;--> statement-breakpoint
CREATE INDEX "dive_packages_shop_idx" ON "dive_packages" ("shop_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");