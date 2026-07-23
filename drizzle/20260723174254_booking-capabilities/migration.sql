CREATE TYPE "booking_capability_purpose" AS ENUM('readiness', 'confirm');--> statement-breakpoint
CREATE TABLE "booking_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" "booking_capability_purpose" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_capabilities_token_hash_idx" ON "booking_capabilities" ("token_hash");--> statement-breakpoint
CREATE INDEX "booking_capabilities_booking_purpose_idx" ON "booking_capabilities" ("booking_id","purpose","revoked_at");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");