ALTER TYPE "notification_kind" ADD VALUE 'gift_pass';--> statement-breakpoint
CREATE TABLE "booking_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL UNIQUE,
	"giver_name" text NOT NULL,
	"giver_email" text NOT NULL,
	"receiver_name" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL UNIQUE,
	"referred_by_booking_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_gifts_shop_idx" ON "booking_gifts" ("shop_id");--> statement-breakpoint
CREATE INDEX "booking_referrals_shop_idx" ON "booking_referrals" ("shop_id");--> statement-breakpoint
ALTER TABLE "booking_gifts" ADD CONSTRAINT "booking_gifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_gifts" ADD CONSTRAINT "booking_gifts_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_referred_by_booking_id_bookings_id_fkey" FOREIGN KEY ("referred_by_booking_id") REFERENCES "bookings"("id");