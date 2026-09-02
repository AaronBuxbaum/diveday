ALTER TABLE "bookings" ADD COLUMN "referral_source" text;--> statement-breakpoint
CREATE INDEX "bookings_shop_referral_idx" ON "bookings" ("shop_id","referral_source");