CREATE TABLE "wallet_pass_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"device_library_identifier" text NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"locale" text NOT NULL,
	"authentication_token_hash" text,
	"google_object_id" text,
	"content_hash" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wallet_passes_platform_check" CHECK ("platform" in ('apple', 'google')),
	CONSTRAINT "wallet_passes_credentials_check" CHECK (("platform" = 'apple' and "authentication_token_hash" is not null and "google_object_id" is null) or ("platform" = 'google' and "authentication_token_hash" is null and "google_object_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "wallet_passes_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_registrations_live_device_idx" ON "wallet_pass_registrations" ("pass_id","device_library_identifier") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "wallet_registrations_shop_idx" ON "wallet_pass_registrations" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_live_booking_platform_idx" ON "wallet_passes" ("booking_id","platform") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_shop_id_id_idx" ON "wallet_passes" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "wallet_passes_shop_idx" ON "wallet_passes" ("shop_id");--> statement-breakpoint
ALTER TABLE "wallet_pass_registrations" ADD CONSTRAINT "wallet_pass_registrations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "wallet_pass_registrations" ADD CONSTRAINT "wallet_registrations_shop_pass_fk" FOREIGN KEY ("shop_id","pass_id") REFERENCES "wallet_passes"("shop_id","id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_shop_booking_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id");