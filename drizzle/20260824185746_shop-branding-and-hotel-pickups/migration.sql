ALTER TYPE "media_deletion_kind" ADD VALUE 'shop_logo';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "hotel_pickup_location" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pickup_time" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "logo_url" text;